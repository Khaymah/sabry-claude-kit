import { and, eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, Orders } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { SendSms } from "../../Lib/Sms";

async function Load(CompanyId: number, OrderId: number) {
  const [Row] = await Db.select({ Order: Orders, Phone: Customers.Phone, Language: Customers.Language })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  return Row;
}

function ReceiptText(Language: string, OrderId: number, Total: string) {
  return Language === "en" ? `Thank you! Order #${OrderId} is paid. Total: ${Total} EGP` : `شكراً لك! تم دفع طلبك رقم ${OrderId} بإجمالي ${Total} جنيه`;
}

async function Send(CompanyId: number, OrderId: number) {
  const Row = await Load(CompanyId, OrderId);
  if (!Row?.Phone) return false;
  return SendSms(Row.Phone, ReceiptText(Row.Language, OrderId, Row.Order.Total), `receipt-${OrderId}-${Date.now()}`);
}

export function SendReceiptInBackground(CompanyId: number, OrderId: number) {
  Send(CompanyId, OrderId).catch(() => false);
}

export async function ResendReceipt(CompanyId: number, OrderId: number) {
  const Row = await Load(CompanyId, OrderId);
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  if (Row.Order.Status !== "Paid") throw new AppError(409, "ORDER_NOT_PAID", "Only paid orders have a receipt");
  if (!Row.Phone) throw new AppError(422, "CUSTOMER_HAS_NO_PHONE", "Customer has no phone number");
  if (!(await Send(CompanyId, OrderId))) throw new AppError(502, "SMS_FAILED", "The SMS provider did not accept the message");
  return { Sent: true };
}
