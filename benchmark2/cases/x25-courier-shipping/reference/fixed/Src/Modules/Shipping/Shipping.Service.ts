import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { Db } from "../../Database/Db";
import { CourierEvents, Customers, Orders } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { GetSetting } from "../Settings/Settings.Service";

export async function ShipOrder(CompanyId: number, OrderId: number) {
  const [Row] = await Db.select({ Order: Orders, Name: Customers.Name, Phone: Customers.Phone })
    .from(Orders)
    .innerJoin(Customers, eq(Customers.Id, Orders.CustomerId))
    .where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Order not found");
  if (Row.Order.Status !== "Paid") throw new AppError(409, "ORDER_NOT_PAID", "Only paid orders can be shipped");
  const [Claimed] = await Db.update(Orders)
    .set({ ShipmentStatus: "Requesting" })
    .where(and(eq(Orders.Id, OrderId), isNull(Orders.TrackingNumber), or(isNull(Orders.ShipmentStatus), eq(Orders.ShipmentStatus, "Failed"))))
    .returning({ Id: Orders.Id });
  if (!Claimed) throw new AppError(409, "ALREADY_SHIPPED", "A shipment already exists for this order");

  const BaseUrl = await GetSetting<string>("Courier.BaseUrl", "");
  const ApiKey = await GetSetting<string>("Courier.ApiKey", "");
  const TimeoutMs = await GetSetting<number>("Courier.TimeoutMs", 5000);
  const Controller = new AbortController();
  const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
  let Tracking: string | null = null;
  try {
    const Res = await fetch(`${BaseUrl.replace(/\/$/, "")}/v1/shipments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ Reference: `order-${OrderId}`, RecipientName: Row.Name, RecipientPhone: Row.Phone ?? "" }),
      signal: Controller.signal,
    });
    if (Res.ok) Tracking = String(((await Res.json()) as { TrackingNumber: string }).TrackingNumber);
  } catch {
  } finally {
    clearTimeout(Timer);
  }
  if (!Tracking) {
    await Db.update(Orders).set({ ShipmentStatus: "Failed" }).where(eq(Orders.Id, OrderId));
    throw new AppError(502, "COURIER_FAILED", "The courier did not accept the shipment");
  }
  const [Updated] = await Db.update(Orders)
    .set({ TrackingNumber: Tracking, ShipmentStatus: "Created", ShipmentUpdatedAt: null })
    .where(eq(Orders.Id, OrderId))
    .returning();
  return { TrackingNumber: Updated.TrackingNumber, ShipmentStatus: Updated.ShipmentStatus };
}

const StatusMap: Record<string, string> = { picked_up: "PickedUp", in_transit: "InTransit", delivered: "Delivered", returned: "Returned" };

const CourierEvent = z.object({
  EventId: z.string().min(1).max(100),
  TrackingNumber: z.string().min(1).max(100),
  Status: z.enum(["picked_up", "in_transit", "delivered", "returned"]),
  OccurredAt: z.iso.datetime({ offset: true }),
});

export async function HandleCourierWebhook(RawBody: string, Signature: string) {
  const Secret = await GetSetting<string>("Courier.WebhookSecret", "");
  const Expected = Buffer.from(createHmac("sha256", Secret).update(RawBody).digest("hex"));
  const Given = Buffer.from(Signature);
  if (!Secret || Given.length !== Expected.length || !timingSafeEqual(Given, Expected)) throw new AppError(401, "INVALID_SIGNATURE", "Signature mismatch");
  let Parsed: unknown;
  try {
    Parsed = JSON.parse(RawBody);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Body must be valid JSON");
  }
  const Result = CourierEvent.safeParse(Parsed);
  if (!Result.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid event");
  const Event = Result.data;
  const OccurredAt = new Date(Event.OccurredAt);
  return Db.transaction(async (Tx) => {
    const Fresh = await Tx.insert(CourierEvents).values({ EventId: Event.EventId }).onConflictDoNothing().returning({ EventId: CourierEvents.EventId });
    if (Fresh.length === 0) return { Received: true, Duplicate: true };
    await Tx.update(Orders)
      .set({ ShipmentStatus: StatusMap[Event.Status], ShipmentUpdatedAt: OccurredAt })
      .where(and(eq(Orders.TrackingNumber, Event.TrackingNumber), sql`(${Orders.ShipmentUpdatedAt} IS NULL OR ${Orders.ShipmentUpdatedAt} <= ${OccurredAt.toISOString()}::timestamptz)`));
    return { Received: true };
  });
}
