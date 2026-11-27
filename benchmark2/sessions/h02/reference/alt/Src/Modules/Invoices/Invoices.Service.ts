import { Client } from "../../Database/Db";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { GetSubscription, IsoDay, Portions, Q, ShiftMonths } from "../Subscriptions/Subscriptions.Service";

const View = `
  SELECT I."Id", I."SubscriptionId", I."Source" AS "Kind",
    to_char(I."PeriodStart", 'YYYY-MM-DD') AS "PeriodStart", to_char(I."PeriodEnd", 'YYYY-MM-DD') AS "PeriodEnd", to_char(I."DueDate", 'YYYY-MM-DD') AS "DueDate",
    (I."GrossPiasters" - I."DiscountPiasters") AS "Amount", I."DiscountPiasters" AS "Discount", I."State" AS "Status",
    coalesce((SELECT sum(M."Piasters") FROM "MoneyMovements" M WHERE M."InvoiceId" = I."Id" AND M."Direction" = 'In'), 0)::int AS "AmountPaid",
    coalesce((SELECT sum(M."Piasters") FROM "MoneyMovements" M WHERE M."InvoiceId" = I."Id" AND M."Direction" = 'Out'), 0)::int AS "AmountRefunded"
  FROM "BillingInvoices" I`;

type InvoiceView = { Id: number; SubscriptionId: number; Amount: number; Discount: number; Status: string; AmountPaid: number; AmountRefunded: number; PeriodStart: string; PeriodEnd: string };

export async function ReadInvoice(CompanyId: number, Id: number) {
  const [Row] = await Q<InvoiceView>(`${View} WHERE I."Id" = $1 AND I."CompanyId" = $2`, [Id, CompanyId]);
  if (!Row) throw new AppError(404, "NOT_FOUND", "Invoice not found");
  return Row;
}

export async function SubscriptionInvoices(CompanyId: number, SubscriptionId: number) {
  await GetSubscription(CompanyId, SubscriptionId);
  return Q<InvoiceView>(`${View} WHERE I."SubscriptionId" = $1 AND I."CompanyId" = $2 ORDER BY I."PeriodStart", I."Id"`, [SubscriptionId, CompanyId]);
}

export async function Settle(CompanyId: number, Id: number, Method: string) {
  const Current = await ReadInvoice(CompanyId, Id);
  await Client.transaction(async (Tx) => {
    const Won = await Tx.query(`UPDATE "BillingInvoices" SET "State" = 'Paid' WHERE "Id" = $1 AND "State" = 'Open' RETURNING "Id"`, [Id]);
    if (!Won.rows.length) throw new AppError(409, "NOT_PAYABLE", "This invoice is not open");
    if (Current.Amount > 0)
      await Tx.query(`INSERT INTO "MoneyMovements" ("CompanyId","InvoiceId","Direction","Piasters","Method","At") VALUES ($1,$2,'In',$3,$4,$5)`, [CompanyId, Id, Current.Amount, Method, Now()]);
  });
  return ReadInvoice(CompanyId, Id);
}

export async function NewCoupon(CompanyId: number, Code: string, PercentOff: number, MaxRedemptions: number) {
  const [Row] = await Q(
    `INSERT INTO "Coupons" ("CompanyId","Code","PercentOff","MaxRedemptions") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING "Id","Code","PercentOff","MaxRedemptions"`,
    [CompanyId, Code, PercentOff, MaxRedemptions],
  );
  if (!Row) throw new AppError(409, "DUPLICATE_CODE", "This code already exists");
  return Row;
}

export async function Redeem(CompanyId: number, Id: number, Code: string) {
  await ReadInvoice(CompanyId, Id);
  const [Coupon] = await Q<{ Id: number; PercentOff: number }>(`SELECT "Id","PercentOff" FROM "Coupons" WHERE "CompanyId" = $1 AND "Code" = $2`, [CompanyId, Code]);
  if (!Coupon) throw new AppError(404, "NOT_FOUND", "Coupon not found");
  await Client.transaction(async (Tx) => {
    const Marked = await Tx.query(
      `UPDATE "BillingInvoices" SET "CouponId" = $2, "DiscountPiasters" = "GrossPiasters" - ("GrossPiasters" * (100 - $3)) / 100
       WHERE "Id" = $1 AND "State" = 'Open' AND "CouponId" IS NULL RETURNING "Id"`,
      [Id, Coupon.Id, Coupon.PercentOff],
    );
    if (!Marked.rows.length) throw new AppError(409, "NOT_ELIGIBLE", "This invoice cannot take a coupon");
    const Counted = await Tx.query(`UPDATE "Coupons" SET "Used" = "Used" + 1 WHERE "Id" = $1 AND "Used" < "MaxRedemptions" RETURNING "Id"`, [Coupon.Id]);
    if (!Counted.rows.length) throw new AppError(409, "COUPON_EXHAUSTED", "This coupon is used up");
  });
  return ReadInvoice(CompanyId, Id);
}

export async function GiveBack(CompanyId: number, Id: number, Amount: number, Note: string | undefined) {
  const Current = await ReadInvoice(CompanyId, Id);
  if (Current.Status !== "Paid") throw new AppError(409, "NOT_PAID", "Only paid invoices can be refunded");
  const Made = await Q(
    `INSERT INTO "MoneyMovements" ("CompanyId","InvoiceId","Direction","Piasters","Note","At")
     SELECT $1::int, $2::int, 'Out', $3::int, $4::text, $5::timestamptz
     WHERE (SELECT coalesce(sum(CASE WHEN "Direction" = 'In' THEN "Piasters" ELSE -"Piasters" END), 0) FROM "MoneyMovements" WHERE "InvoiceId" = $2::int) >= $3::int
     RETURNING "Id"`,
    [CompanyId, Id, Amount, Note ?? null, Now()],
  );
  if (!Made.length) throw new AppError(409, "OVER_REFUND", "Refund exceeds what was paid");
  return { RefundId: (Made[0] as { Id: number }).Id, Invoice: await ReadInvoice(CompanyId, Id) };
}

export async function Divide(CompanyId: number, Id: number, Parts: number) {
  const Current = await ReadInvoice(CompanyId, Id);
  const Today = IsoDay(Now());
  const Ids = await Client.transaction(async (Tx) => {
    const Voided = await Tx.query<{ CouponId: number | null }>(`UPDATE "BillingInvoices" SET "State" = 'Void' WHERE "Id" = $1 AND "State" = 'Open' RETURNING "CouponId"`, [Id]);
    if (!Voided.rows.length) throw new AppError(409, "NOT_OPEN", "Only open invoices can be split");
    if (Current.Amount < Parts) throw new AppError(409, "TOO_SMALL", "The invoice is too small to split");
    const Out: number[] = [];
    for (const [I, Piasters] of Portions(Current.Amount, Parts).entries()) {
      const Row = await Tx.query<{ Id: number }>(
        `INSERT INTO "BillingInvoices" ("CompanyId","SubscriptionId","Source","PeriodStart","PeriodEnd","DueDate","GrossPiasters","CouponId") VALUES ($1,$2,'Split',$3,$4,$5,$6,$7) RETURNING "Id"`,
        [CompanyId, Current.SubscriptionId, Current.PeriodStart, Current.PeriodEnd, ShiftMonths(Today, I), Piasters, Voided.rows[0].CouponId],
      );
      Out.push(Row.rows[0].Id);
    }
    return Out;
  });
  const Invoices = [];
  for (const New of Ids) Invoices.push(await ReadInvoice(CompanyId, New));
  return { Invoices };
}
