import { sql, type SQL } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { AppError } from "../../Lib/Response";
import { ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { GetSetting } from "../Settings/Settings.Service";
import type { AuthContext } from "../../Middleware/Auth";

type Ex = Transaction | typeof Db;
type LineIn = { ProductId: number; Quantity: number; DiscountPercent: number };
type StoredLine = { ProductId: number; Quantity: number; DiscountPercent: string; UnitPrice: string; LineTotal: string };
type QuoteRow = {
  Id: number;
  CustomerId: number;
  CreatedBy: number;
  State: string;
  Revision: number;
  ValidUntil: string;
  Subtotal: string;
  Tax: string;
  Total: string;
  Lines: StoredLine[];
  ApproverId: number | null;
  OrderId: number | null;
};

const NotFound = (What: string) => new AppError(404, "NOT_FOUND", `${What} not found`);
const List = (Values: unknown[]) => sql.join(Values.map((V) => sql`${V}`), sql`, `);

async function Rows<T>(E: Ex, Query: SQL): Promise<T[]> {
  return ((await E.execute(Query)) as unknown as { rows: T[] }).rows;
}

const Today = () => Now().toISOString().slice(0, 10);
const OpenStates = ["Draft", "PendingApproval", "Approved"];
const Shown = (Q: { State: string; ValidUntil: string }) => (OpenStates.includes(Q.State) && Q.ValidUntil < Today() ? "Expired" : Q.State);
const StillValid = () => sql`("IssuedOn" + "ValidDays" - 1) >= ${Today()}::date`;

async function OwnCustomer(E: Ex, CompanyId: number, CustomerId: number) {
  const [Row] = await Rows<{ PricingGroupId: number | null }>(
    E,
    sql`SELECT "PricingGroupId" FROM "Customers" WHERE "Id" = ${CustomerId} AND "CompanyId" = ${CompanyId}`,
  );
  if (!Row) throw NotFound("Customer");
  return Row;
}

async function PriceMap(E: Ex, CompanyId: number, CustomerId: number, Day: string, ProductIds?: number[]) {
  const Products = await Rows<{ Id: number; Price: string }>(
    E,
    sql`SELECT "Id", "Price"::text AS "Price" FROM "Products" WHERE "CompanyId" = ${CompanyId} AND "IsActive" ${ProductIds ? sql`AND "Id" IN (${List(ProductIds)})` : sql``} ORDER BY "Id"`,
  );
  const Lists = await Rows<{ Prices: Record<string, string> }>(
    E,
    sql`SELECT "Prices" FROM "CustomerPriceLists" WHERE "CompanyId" = ${CompanyId} AND "CustomerId" = ${CustomerId}
        AND "ValidFrom" <= ${Day}::date AND ("ValidTo" IS NULL OR "ValidTo" >= ${Day}::date) ORDER BY "Id"`,
  );
  const Result = new Map<number, string>(Products.map((P) => [P.Id, P.Price]));
  for (const L of Lists) for (const [Key, Price] of Object.entries(L.Prices)) if (Result.has(Number(Key))) Result.set(Number(Key), Price);
  return Result;
}

export async function CreatePriceList(CompanyId: number, Body: { CustomerId: number; ValidFrom: string; ValidTo?: string; Items: { ProductId: number; Price: string }[] }) {
  await OwnCustomer(Db, CompanyId, Body.CustomerId);
  const Ids = Body.Items.map((I) => I.ProductId);
  const [Found] = await Rows<{ N: number }>(Db, sql`SELECT count(*)::int AS "N" FROM "Products" WHERE "CompanyId" = ${CompanyId} AND "Id" IN (${List(Ids)})`);
  if (Found.N !== Ids.length) throw NotFound("Product");
  const Prices = Object.fromEntries(Body.Items.map((I) => [String(I.ProductId), Number(I.Price).toFixed(2)]));
  const [Row] = await Rows<{ Id: number }>(
    Db,
    sql`INSERT INTO "CustomerPriceLists" ("CompanyId", "CustomerId", "ValidFrom", "ValidTo", "Prices")
        VALUES (${CompanyId}, ${Body.CustomerId}, ${Body.ValidFrom}, ${Body.ValidTo ?? null}, ${JSON.stringify(Prices)}::jsonb) RETURNING "Id"`,
  );
  return { Id: Row.Id, CustomerId: Body.CustomerId, ValidFrom: Body.ValidFrom, ValidTo: Body.ValidTo ?? null, Items: Body.Items };
}

export async function CustomerPrices(CompanyId: number, CustomerId: number, Day: string) {
  await OwnCustomer(Db, CompanyId, CustomerId);
  const Map_ = await PriceMap(Db, CompanyId, CustomerId, Day);
  return { Date: Day, Items: [...Map_].map(([ProductId, Price]) => ({ ProductId, Price })) };
}

async function Price(E: Ex, CompanyId: number, CustomerId: number, Lines: LineIn[], TaxRate: number) {
  const Ids = [...new Set(Lines.map((L) => L.ProductId))];
  const Map_ = await PriceMap(E, CompanyId, CustomerId, Today(), Ids);
  if (Map_.size !== Ids.length) throw NotFound("Product");
  const Values = sql.join(
    Lines.map((L, I) => sql`(${I}::int, ${Map_.get(L.ProductId)}::numeric, ${L.Quantity}::numeric, ${L.DiscountPercent}::numeric)`),
    sql`, `,
  );
  const [Calc] = await Rows<{ Lines: string[]; Subtotal: string; Tax: string; Total: string }>(
    E,
    sql`WITH V ("I", "Unit", "Qty", "Disc") AS (VALUES ${Values}),
         L AS (SELECT "I", round("Unit" * "Qty" * (100 - "Disc") / 100, 2) AS "T" FROM V),
         S AS (SELECT sum("T") AS "Sub" FROM L),
         X AS (SELECT "Sub", round("Sub" * ${TaxRate}::numeric / 100, 2) AS "Tax" FROM S)
        SELECT (SELECT json_agg("T"::text ORDER BY "I") FROM L) AS "Lines", "Sub"::text AS "Subtotal", "Tax"::text AS "Tax", ("Sub" + "Tax")::text AS "Total" FROM X`,
  );
  if (Number(Calc.Total) > 9_999_999_999.99) throw new AppError(400, "VALIDATION_ERROR", "Quote is too large");
  const Stored: StoredLine[] = Lines.map((L, I) => ({
    ProductId: L.ProductId,
    Quantity: L.Quantity,
    DiscountPercent: L.DiscountPercent.toFixed(2),
    UnitPrice: Map_.get(L.ProductId)!,
    LineTotal: Calc.Lines[I],
  }));
  return { Lines: Stored, Subtotal: Calc.Subtotal, Tax: Calc.Tax, Total: Calc.Total };
}

async function Validity(E: Ex, CompanyId: number) {
  const [Row] = await Rows<{ Value: number }>(E, sql`SELECT "Value" FROM "CompanySettings" WHERE "CompanyId" = ${CompanyId} AND "Key" = 'QuoteValidityDays'`);
  return Row ? Number(Row.Value) : 14;
}

export async function SetValidity(CompanyId: number, Days: number) {
  await Rows(
    Db,
    sql`INSERT INTO "CompanySettings" ("CompanyId", "Key", "Value") VALUES (${CompanyId}, 'QuoteValidityDays', ${JSON.stringify(Days)}::jsonb)
        ON CONFLICT ("CompanyId", "Key") DO UPDATE SET "Value" = EXCLUDED."Value"`,
  );
  return { ValidityDays: Days };
}

export async function GetValidity(CompanyId: number) {
  return { ValidityDays: await Validity(Db, CompanyId) };
}

async function Load(E: Ex, CompanyId: number, Id: number) {
  const [Row] = await Rows<QuoteRow>(
    E,
    sql`SELECT "Id", "CustomerId", "CreatedBy", "State", "Revision", ("IssuedOn" + "ValidDays" - 1)::text AS "ValidUntil",
          "Subtotal"::text AS "Subtotal", "Tax"::text AS "Tax", "Total"::text AS "Total", "Lines", "ApproverId", "OrderId"
        FROM "SalesQuotes" WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId}`,
  );
  if (!Row) throw NotFound("Quote");
  return Row;
}

function View(Q: QuoteRow) {
  return {
    Id: Q.Id,
    CustomerId: Q.CustomerId,
    SalespersonId: Q.CreatedBy,
    Status: Shown(Q),
    Version: Q.Revision,
    ValidUntil: Q.ValidUntil,
    ApprovedBy: Q.ApproverId,
    OrderId: Q.OrderId,
    Subtotal: Q.Subtotal,
    Tax: Q.Tax,
    Total: Q.Total,
    Items: Q.Lines,
  };
}

export async function GetQuote(CompanyId: number, Id: number) {
  return View(await Load(Db, CompanyId, Id));
}

export async function QuoteVersions(CompanyId: number, Id: number) {
  await Load(Db, CompanyId, Id);
  return Rows(
    Db,
    sql`SELECT "Revision" AS "Version", "Subtotal"::text AS "Subtotal", "Tax"::text AS "Tax", "Total"::text AS "Total", "Lines" AS "Items", "CreatedAt"
        FROM "SalesQuoteRevisions" WHERE "QuoteId" = ${Id} ORDER BY "Revision"`,
  );
}

const TaxRate = () => GetSetting<number>("Tax.RatePercent", 14);

export async function CreateQuote(Auth: AuthContext, Body: { CustomerId: number; Items: LineIn[] }) {
  const Rate = await TaxRate();
  const Id = await Db.transaction(async (Tx) => {
    await OwnCustomer(Tx, Auth.CompanyId, Body.CustomerId);
    const P = await Price(Tx, Auth.CompanyId, Body.CustomerId, Body.Items, Rate);
    const Days = await Validity(Tx, Auth.CompanyId);
    const At = Now();
    const [Row] = await Rows<{ Id: number }>(
      Tx,
      sql`INSERT INTO "SalesQuotes" ("CompanyId", "CustomerId", "CreatedBy", "IssuedOn", "ValidDays", "Subtotal", "Tax", "Total", "Lines", "CreatedAt")
          VALUES (${Auth.CompanyId}, ${Body.CustomerId}, ${Auth.UserId}, ${Today()}, ${Days}, ${P.Subtotal}, ${P.Tax}, ${P.Total}, ${JSON.stringify(P.Lines)}::jsonb, ${At})
          RETURNING "Id"`,
    );
    await Rows(
      Tx,
      sql`INSERT INTO "SalesQuoteRevisions" ("QuoteId", "Revision", "Subtotal", "Tax", "Total", "Lines", "CreatedAt")
          VALUES (${Row.Id}, 1, ${P.Subtotal}, ${P.Tax}, ${P.Total}, ${JSON.stringify(P.Lines)}::jsonb, ${At})`,
    );
    return Row.Id;
  });
  return GetQuote(Auth.CompanyId, Id);
}

async function Refuse(CompanyId: number, Id: number, Message: string): Promise<never> {
  await Load(Db, CompanyId, Id);
  throw new AppError(409, "INVALID_STATUS", Message);
}

export async function ReviseQuote(CompanyId: number, Id: number, Items: LineIn[]) {
  const Rate = await TaxRate();
  const Current = await Load(Db, CompanyId, Id);
  const Done = await Db.transaction(async (Tx) => {
    const P = await Price(Tx, CompanyId, Current.CustomerId, Items, Rate);
    const Days = await Validity(Tx, CompanyId);
    const [Row] = await Rows<{ Revision: number }>(
      Tx,
      sql`UPDATE "SalesQuotes" SET "Revision" = "Revision" + 1, "IssuedOn" = ${Today()}, "ValidDays" = ${Days},
            "Subtotal" = ${P.Subtotal}, "Tax" = ${P.Tax}, "Total" = ${P.Total}, "Lines" = ${JSON.stringify(P.Lines)}::jsonb
          WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} AND "State" = 'Draft' AND ${StillValid()}
          RETURNING "Revision"`,
    );
    if (!Row) return false;
    await Rows(
      Tx,
      sql`INSERT INTO "SalesQuoteRevisions" ("QuoteId", "Revision", "Subtotal", "Tax", "Total", "Lines", "CreatedAt")
          VALUES (${Id}, ${Row.Revision}, ${P.Subtotal}, ${P.Tax}, ${P.Total}, ${JSON.stringify(P.Lines)}::jsonb, ${Now()})`,
    );
    return true;
  });
  if (!Done) await Refuse(CompanyId, Id, "Only valid draft quotes can be revised");
  return GetQuote(CompanyId, Id);
}

async function Threshold(E: Ex, CompanyId: number, GroupId: number | null) {
  const [Row] = await Rows<{ Threshold: string }>(
    E,
    GroupId === null
      ? sql`SELECT "Threshold"::text AS "Threshold" FROM "PricingGroups" WHERE "CompanyId" = ${CompanyId} AND "IsStandard"`
      : sql`SELECT "Threshold"::text AS "Threshold" FROM "PricingGroups" WHERE "CompanyId" = ${CompanyId} AND "Id" = ${GroupId}`,
  );
  return ToPiasters(Row?.Threshold ?? "50000.00");
}

export async function SubmitQuote(CompanyId: number, Id: number) {
  const Q = await Load(Db, CompanyId, Id);
  const Customer = await OwnCustomer(Db, CompanyId, Q.CustomerId);
  const Limit = await Threshold(Db, CompanyId, Customer.PricingGroupId);
  const Next = ToPiasters(Q.Total) > Limit ? "PendingApproval" : "Approved";
  const Moved = await Rows(
    Db,
    sql`UPDATE "SalesQuotes" SET "State" = ${Next} WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} AND "State" = 'Draft'
          AND "Revision" = ${Q.Revision} AND ${StillValid()} RETURNING "Id"`,
  );
  if (!Moved.length) await Refuse(CompanyId, Id, "Only valid draft quotes can be submitted");
  return GetQuote(CompanyId, Id);
}

export async function ApproveQuote(Auth: AuthContext, Id: number) {
  const Q = await Load(Db, Auth.CompanyId, Id);
  if (Q.CreatedBy === Auth.UserId) throw new AppError(403, "FORBIDDEN", "You cannot approve your own quote");
  const Moved = await Rows(
    Db,
    sql`UPDATE "SalesQuotes" SET "State" = 'Approved', "ApproverId" = ${Auth.UserId}
        WHERE "Id" = ${Id} AND "CompanyId" = ${Auth.CompanyId} AND "State" = 'PendingApproval' AND ${StillValid()} RETURNING "Id"`,
  );
  if (!Moved.length) throw new AppError(409, "INVALID_STATUS", "Quote is not awaiting approval");
  return { Id, Status: "Approved", ApprovedBy: Auth.UserId };
}

export async function ConvertQuote(CompanyId: number, Id: number) {
  await Load(Db, CompanyId, Id);
  const OrderId = await Db.transaction(async (Tx) => {
    const [Q] = await Rows<{ CustomerId: number; Lines: StoredLine[]; Subtotal: string; Tax: string; Total: string }>(
      Tx,
      sql`UPDATE "SalesQuotes" SET "State" = 'Converted' WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} AND "State" = 'Approved' AND ${StillValid()}
          RETURNING "CustomerId", "Lines", "Subtotal"::text AS "Subtotal", "Tax"::text AS "Tax", "Total"::text AS "Total"`,
    );
    if (!Q) throw new AppError(409, "INVALID_STATUS", "Only approved quotes can be converted");
    const Need = new Map<number, number>();
    for (const L of Q.Lines) Need.set(L.ProductId, (Need.get(L.ProductId) ?? 0) + L.Quantity);
    const Wanted = sql.join([...Need].map(([P, N]) => sql`(${P}::int, ${N}::int)`), sql`, `);
    const Taken = await Rows<{ Id: number }>(
      Tx,
      sql`UPDATE "Products" P SET "Stock" = P."Stock" - W."N" FROM (VALUES ${Wanted}) AS W ("P", "N")
          WHERE P."Id" = W."P" AND P."CompanyId" = ${CompanyId} AND P."Stock" >= W."N" RETURNING P."Id"`,
    );
    if (Taken.length !== Need.size) throw new AppError(409, "OUT_OF_STOCK", "Not enough stock for this quote");
    const [Order] = await Rows<{ Id: number }>(
      Tx,
      sql`INSERT INTO "Orders" ("CompanyId", "CustomerId", "Subtotal", "Tax", "Total", "CreatedAt")
          VALUES (${CompanyId}, ${Q.CustomerId}, ${Q.Subtotal}, ${Q.Tax}, ${Q.Total}, ${Now()}) RETURNING "Id"`,
    );
    const Items = sql.join(
      Q.Lines.map((L) => sql`(${Order.Id}, ${L.ProductId}, ${L.Quantity}, ${L.UnitPrice}::numeric, ${L.LineTotal}::numeric)`),
      sql`, `,
    );
    await Rows(Tx, sql`INSERT INTO "OrderItems" ("OrderId", "ProductId", "Quantity", "UnitPrice", "LineTotal") VALUES ${Items}`);
    await Rows(Tx, sql`UPDATE "SalesQuotes" SET "OrderId" = ${Order.Id} WHERE "Id" = ${Id}`);
    return Order.Id;
  });
  return { QuoteId: Id, Status: "Converted", OrderId };
}

const GroupColumns = sql`"Id", "Name", "Threshold"::text AS "ApprovalThreshold"`;

export async function ListGroups(CompanyId: number) {
  return Rows(Db, sql`SELECT ${GroupColumns} FROM "PricingGroups" WHERE "CompanyId" = ${CompanyId} ORDER BY "IsStandard" DESC, "Id"`);
}

export async function CreateGroup(CompanyId: number, Body: { Name: string; ApprovalThreshold: string }) {
  const [Row] = await Rows(
    Db,
    sql`INSERT INTO "PricingGroups" ("CompanyId", "Name", "Threshold") VALUES (${CompanyId}, ${Body.Name}, ${Body.ApprovalThreshold}) RETURNING ${GroupColumns}`,
  );
  return Row;
}

export async function UpdateGroup(CompanyId: number, Id: number, Threshold: string) {
  const [Row] = await Rows(
    Db,
    sql`UPDATE "PricingGroups" SET "Threshold" = ${Threshold} WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} RETURNING ${GroupColumns}`,
  );
  if (!Row) throw NotFound("Group");
  return Row;
}

export async function RequireGroup(CompanyId: number, Id: number) {
  const [Row] = await Rows(Db, sql`SELECT "Id" FROM "PricingGroups" WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId}`);
  if (!Row) throw NotFound("Group");
}

export async function SalesBySalesperson(CompanyId: number) {
  const Quotes = await Rows<{ UserId: number; Name: string; QuotesCount: number }>(
    Db,
    sql`SELECT U."Id" AS "UserId", U."Name", count(*)::int AS "QuotesCount" FROM "SalesQuotes" Q JOIN "Users" U ON U."Id" = Q."CreatedBy"
        WHERE Q."CompanyId" = ${CompanyId} GROUP BY U."Id", U."Name"`,
  );
  const Sales = await Rows<{ UserId: number; OrdersCount: number; SalesTotal: string }>(
    Db,
    sql`SELECT Q."CreatedBy" AS "UserId", count(*)::int AS "OrdersCount", sum(O."Total")::text AS "SalesTotal"
        FROM "SalesQuotes" Q JOIN "Orders" O ON O."Id" = Q."OrderId"
        WHERE Q."CompanyId" = ${CompanyId} AND O."CompanyId" = ${CompanyId} AND O."Status" <> 'Cancelled' GROUP BY Q."CreatedBy"`,
  );
  const ByUser = new Map(Sales.map((S) => [S.UserId, S]));
  const Items = Quotes.map((Q) => {
    const S = ByUser.get(Q.UserId);
    return { ...Q, OrdersCount: S?.OrdersCount ?? 0, SalesTotal: S ? Number(S.SalesTotal).toFixed(2) : "0.00" };
  });
  Items.sort((X, Y) => ToPiasters(Y.SalesTotal) - ToPiasters(X.SalesTotal) || X.UserId - Y.UserId);
  return { Items };
}
