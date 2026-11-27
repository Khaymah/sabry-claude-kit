import { and, eq, isNotNull, lt } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Customers, Orders, ReminderLog } from "../../Database/Schema";
import { Now } from "../../Lib/Clock";
import { SendSms } from "../../Lib/Sms";

export async function SendPaymentReminders(CompanyId: number) {
  const At = Now();
  const Today = At.toISOString().slice(0, 10);
  const Cutoff = new Date(At.getTime() - 3 * 86400_000);
  const Rows = await Db.select({ OrderId: Orders.Id, Total: Orders.Total, Phone: Customers.Phone })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.CompanyId, CompanyId), eq(Orders.Status, "Pending"), lt(Orders.CreatedAt, Cutoff), isNotNull(Customers.Phone)));
  let Sent = 0;
  for (const Row of Rows) {
    const [Claimed] = await Db.insert(ReminderLog).values({ OrderId: Row.OrderId, Day: Today }).onConflictDoNothing().returning({ Id: ReminderLog.Id });
    if (!Claimed) continue;
    const Ok = await SendSms(Row.Phone!, `تذكير: طلبك رقم ${Row.OrderId} بإجمالي ${Row.Total} جنيه لسه مستني الدفع`, `reminder-${Row.OrderId}-${Today}`);
    if (Ok) Sent++;
    else await Db.delete(ReminderLog).where(eq(ReminderLog.Id, Claimed.Id));
  }
  return { Sent };
}
