import { and, eq, isNotNull, lt, or, isNull, ne } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, Orders } from "../../Database/Schema";
import { Now } from "../../Lib/Clock";
import { SendSms } from "../../Lib/Sms";

export async function SendPaymentReminders(CompanyId: number) {
  const At = Now();
  const Today = At.toISOString().slice(0, 10);
  const Claimed = await Db.update(Orders)
    .set({ LastReminderDay: Today })
    .where(and(
      eq(Orders.CompanyId, CompanyId),
      eq(Orders.Status, "Pending"),
      lt(Orders.CreatedAt, new Date(At.getTime() - 3 * 86400_000)),
      or(isNull(Orders.LastReminderDay), ne(Orders.LastReminderDay, Today)),
    ))
    .returning({ Id: Orders.Id, Total: Orders.Total, CustomerId: Orders.CustomerId });
  let Sent = 0;
  for (const O of Claimed) {
    const [C] = await Db.select({ Phone: Customers.Phone }).from(Customers).where(and(eq(Customers.Id, O.CustomerId), isNotNull(Customers.Phone)));
    if (!C?.Phone) continue;
    if (await SendSms(C.Phone, `تذكير بدفع الطلب ${O.Id} (${O.Total} جنيه)`, `reminder-${O.Id}-${Today}`)) Sent++;
  }
  return { Sent };
}
