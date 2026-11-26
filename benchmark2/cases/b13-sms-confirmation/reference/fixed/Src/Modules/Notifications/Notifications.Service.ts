import { and, eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, Notifications, Orders } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { SendSms } from "./Sms.Client";

async function Claim(CompanyId: number, OrderId: number) {
  const [Inserted] = await Db.insert(Notifications)
    .values({ CompanyId, OrderId, Status: "Sending" })
    .onConflictDoNothing()
    .returning({ Id: Notifications.Id });
  if (Inserted) return Inserted.Id;
  const [Retried] = await Db.update(Notifications)
    .set({ Status: "Sending" })
    .where(and(eq(Notifications.OrderId, OrderId), eq(Notifications.Status, "Failed")))
    .returning({ Id: Notifications.Id });
  if (Retried) return Retried.Id;
  throw new AppError(409, "ALREADY_SENT", "Confirmation was already sent for this order");
}

export async function SendOrderConfirmation(CompanyId: number, OrderId: number) {
  const [Row] = await Db.select({ Order: Orders, Phone: Customers.Phone })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  const Phone = Row.Phone?.trim();
  if (!Phone) throw new AppError(422, "CUSTOMER_HAS_NO_PHONE", "Customer has no phone number");
  const NotificationId = await Claim(CompanyId, OrderId);
  const Text = `تم تأكيد طلبك رقم ${OrderId} بإجمالي ${Row.Order.Total} جنيه`;
  const Result = await SendSms(Phone, Text, `order-${OrderId}`);
  if (!Result.Ok) {
    await Db.update(Notifications).set({ Status: "Failed", Attempts: Result.Attempts }).where(eq(Notifications.Id, NotificationId));
    throw new AppError(502, "SMS_PROVIDER_FAILED", Result.Reason);
  }
  await Db.update(Notifications)
    .set({ Status: "Sent", Attempts: Result.Attempts, ProviderMessageId: Result.MessageId })
    .where(eq(Notifications.Id, NotificationId));
  return { Status: "Sent", Attempts: Result.Attempts, ProviderMessageId: Result.MessageId };
}
