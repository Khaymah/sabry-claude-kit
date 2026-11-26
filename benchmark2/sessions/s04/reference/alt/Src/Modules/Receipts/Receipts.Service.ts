import { and, eq } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, Orders, SmsOutbox } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { SendSms } from "../../Lib/Sms";

const Text = (Language: string, Id: number, Total: string) =>
  Language === "en" ? `Your order ${Id} is paid (${Total} EGP). Thank you!` : `تم دفع الطلب رقم ${Id} بقيمة ${Total} جنيه. شكراً!`;

async function Lookup(Executor: Transaction | typeof Db, CompanyId: number, OrderId: number) {
  const [Row] = await Executor.select({ Status: Orders.Status, Total: Orders.Total, Phone: Customers.Phone, Language: Customers.Language })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  return Row;
}

export async function QueueReceipt(Tx: Transaction, CompanyId: number, OrderId: number) {
  const Row = await Lookup(Tx, CompanyId, OrderId);
  if (!Row?.Phone) return;
  await Tx.insert(SmsOutbox).values({ To: Row.Phone, Text: Text(Row.Language, OrderId, Row.Total), Reference: `receipt-${OrderId}` });
}

export async function FlushOutbox() {
  const Queued = await Db.update(SmsOutbox).set({ State: "Sending" }).where(eq(SmsOutbox.State, "Queued")).returning();
  for (const M of Queued) {
    const Ok = await SendSms(M.To, M.Text, M.Reference).catch(() => false);
    await Db.update(SmsOutbox).set({ State: Ok ? "Sent" : "Failed" }).where(eq(SmsOutbox.Id, M.Id));
  }
}

export async function ResendReceipt(CompanyId: number, OrderId: number) {
  const Row = await Lookup(Db, CompanyId, OrderId);
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  if (Row.Status !== "Paid") throw new AppError(409, "ORDER_NOT_PAID", "Only paid orders have a receipt");
  if (!Row.Phone) throw new AppError(422, "CUSTOMER_HAS_NO_PHONE", "No phone");
  const Ok = await SendSms(Row.Phone, Text(Row.Language, OrderId, Row.Total), `receipt-${OrderId}-resend-${Date.now()}`);
  if (!Ok) throw new AppError(502, "SMS_FAILED", "SMS provider failed");
  return { Sent: true };
}
