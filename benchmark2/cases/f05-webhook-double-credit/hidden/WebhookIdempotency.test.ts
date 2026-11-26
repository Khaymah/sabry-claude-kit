import { beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

const Secret = "whsec_test_123";
let OrderId: number;

beforeEach(async () => {
  await Reset();
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ('PaymentProvider.WebhookSecret', $1::jsonb)`, [JSON.stringify(Secret)]);
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
});

function Deliver(Event: Record<string, unknown>, Options: { Pretty?: boolean; Signature?: string; Attempt?: number } = {}) {
  const Raw = Options.Pretty ? JSON.stringify(Event, null, 2) : JSON.stringify(Event);
  const Signature = Options.Signature ?? createHmac("sha256", Secret).update(Raw).digest("hex");
  return Call("POST", "/Webhooks/Payments", {
    RawBody: Raw,
    Headers: { "Content-Type": "application/json", "X-Signature": Signature, "X-Delivery-Attempt": String(Options.Attempt ?? 1) },
  });
}

async function PaymentsFor(Id: number) {
  return Sql<{ Amount: string }>(`SELECT "Amount"::text AS "Amount" FROM "Payments" WHERE "OrderId" = $1 ORDER BY "Id"`, [Id]);
}

const Ok = (S: number) => S >= 200 && S < 300;

test("a retried delivery is acknowledged and credited once", async () => {
  const Event = { EventId: "evt_1", Type: "payment.succeeded", OrderId, Amount: "114.00", ProviderRef: "ch_1" };
  const First = await Deliver(Event);
  expect(Ok(First.Status)).toBe(true);
  const Retry = await Deliver(Event, { Attempt: 2, Pretty: true });
  expect(Ok(Retry.Status)).toBe(true);
  const Third = await Deliver(Event, { Attempt: 3 });
  expect(Ok(Third.Status)).toBe(true);
  expect(await PaymentsFor(OrderId)).toEqual([{ Amount: "114.00" }]);
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(Order.Status).toBe("Paid");
});

test("simultaneous duplicate deliveries credit once", async () => {
  const Event = { EventId: "evt_burst", Type: "payment.succeeded", OrderId, Amount: "50.00", ProviderRef: "ch_burst" };
  const Results = await Promise.all(Array.from({ length: 6 }, (_, I) => Deliver(Event, { Attempt: I + 1 })));
  expect(Results.every((R) => Ok(R.Status))).toBe(true);
  expect(await PaymentsFor(OrderId)).toEqual([{ Amount: "50.00" }]);
});

test("distinct events for the same order are all credited", async () => {
  const R1 = await Deliver({ EventId: "evt_a", Type: "payment.succeeded", OrderId, Amount: "14.00", ProviderRef: "ch_a" });
  const R2 = await Deliver({ EventId: "evt_b", Type: "payment.succeeded", OrderId, Amount: "100.00", ProviderRef: "ch_b" });
  expect(Ok(R1.Status) && Ok(R2.Status)).toBe(true);
  expect((await PaymentsFor(OrderId)).map((P) => P.Amount)).toEqual(["14.00", "100.00"]);
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(Order.Status).toBe("Paid");
});

test("a tampered delivery is rejected and does not block the genuine one", async () => {
  const Event = { EventId: "evt_t", Type: "payment.succeeded", OrderId, Amount: "114.00", ProviderRef: "ch_t" };
  const Genuine = JSON.stringify(Event);
  const Signature = createHmac("sha256", Secret).update(Genuine).digest("hex");
  const Forged = await Call("POST", "/Webhooks/Payments", {
    RawBody: JSON.stringify({ ...Event, Amount: "1.00" }),
    Headers: { "Content-Type": "application/json", "X-Signature": Signature },
  });
  expect(Forged.Status).toBe(401);
  expect(await PaymentsFor(OrderId)).toEqual([]);
  const Real = await Deliver(Event);
  expect(Ok(Real.Status)).toBe(true);
  expect(await PaymentsFor(OrderId)).toEqual([{ Amount: "114.00" }]);
});

test("a burst of several events with retries credits each event exactly once", async () => {
  const Events = ["x1", "x2", "x3"].map((Id, I) => ({ EventId: Id, Type: "payment.succeeded", OrderId, Amount: `${10 + I}.00`, ProviderRef: `ch_${Id}` }));
  const Results = await Promise.all(Events.flatMap((E) => [Deliver(E), Deliver(E, { Attempt: 2 }), Deliver(E, { Attempt: 3, Pretty: true })]));
  expect(Results.every((R) => Ok(R.Status))).toBe(true);
  const Amounts = (await PaymentsFor(OrderId)).map((P) => P.Amount).sort();
  expect(Amounts).toEqual(["10.00", "11.00", "12.00"]);
});
