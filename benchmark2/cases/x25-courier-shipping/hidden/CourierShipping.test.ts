import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

const RealFetch = globalThis.fetch;
const Secret = "courier_whsec";
let Calls: { Url: string; Auth: string | null; Body: any }[] = [];
let Mode: "ok" | "hang" = "ok";
let Shipments: Map<string, string>;

function InstallCourier() {
  Calls = [];
  Shipments = new Map();
  globalThis.fetch = (async (Input: any, Init: any = {}) => {
    const Url = typeof Input === "string" ? Input : Input instanceof URL ? Input.toString() : Input.url;
    const Headers_ = new Headers(Init.headers ?? (Input instanceof Request ? Input.headers : undefined));
    const Raw = String(Init.body ?? (Input instanceof Request ? await Input.text() : ""));
    const Signal: AbortSignal | undefined = Init.signal ?? (Input instanceof Request ? Input.signal : undefined);
    const Body = JSON.parse(Raw);
    Calls.push({ Url, Auth: Headers_.get("Authorization"), Body });
    const Ref = String(Body.Reference);
    if (!Shipments.has(Ref)) Shipments.set(Ref, `TRK${Shipments.size + 1000}`);
    if (Mode === "hang") return new Promise<Response>((_, Reject) => Signal?.addEventListener("abort", () => Reject(new DOMException("aborted", "AbortError"))));
    return new Response(JSON.stringify({ TrackingNumber: Shipments.get(Ref) }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

async function Setting(Key: string, Value: unknown) {
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ($1,$2::jsonb) ON CONFLICT ("Key") DO UPDATE SET "Value" = EXCLUDED."Value"`, [Key, JSON.stringify(Value)]);
}

let A: Awaited<ReturnType<typeof NewCompany>>;
let Paid: number;
let Pending: number;

beforeEach(async () => {
  await Reset();
  await Setting("Courier.BaseUrl", "https://courier.example.test");
  await Setting("Courier.ApiKey", "ck_test");
  await Setting("Courier.TimeoutMs", 200);
  await Setting("Courier.WebhookSecret", Secret);
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId, { Name: "سلمى", Phone: "01001234567" });
  Paid = await NewOrder(A.CompanyId, Customer, "114.00", "Paid");
  Pending = await NewOrder(A.CompanyId, Customer, "114.00", "Pending");
  Mode = "ok";
  InstallCourier();
});

afterEach(() => {
  globalThis.fetch = RealFetch;
});

const Ship = (Id: number, Token = A.Token) => Call("POST", `/Orders/${Id}/Ship`, { Token });
const Order = async (Id: number) => (await Call("GET", `/Orders/${Id}`, { Token: A.Token })).Body.Data;

function Hook(Event: Record<string, unknown>, Signature?: string) {
  const Raw = JSON.stringify(Event);
  return Call("POST", "/Webhooks/Courier", {
    RawBody: Raw,
    Headers: { "Content-Type": "application/json", "X-Signature": Signature ?? createHmac("sha256", Secret).update(Raw).digest("hex") },
  });
}

test("shipping a paid order books it with the courier", async () => {
  const Res = await Ship(Paid);
  expect(Res.Status).toBe(200);
  expect(Calls.length).toBe(1);
  expect(Calls[0].Url).toBe("https://courier.example.test/v1/shipments");
  expect(Calls[0].Auth).toBe("Bearer ck_test");
  expect(Calls[0].Body).toMatchObject({ RecipientName: "سلمى", RecipientPhone: "01001234567" });
  expect((await Order(Paid)).TrackingNumber).toBe("TRK1000");
});

test("unpaid, foreign and already shipped orders are not booked", async () => {
  expect((await Ship(Pending)).Status).toBe(409);
  const B = await NewCompany();
  expect((await Ship(Paid, B.Token)).Status).toBe(404);
  expect(Calls.length).toBe(0);
  expect((await Ship(Paid)).Status).toBe(200);
  expect((await Ship(Paid)).Status).toBe(409);
  expect(Calls.length).toBe(1);
});

test("a courier that never answers does not hang the request, and trying again books one shipment", async () => {
  Mode = "hang";
  const Started = performance.now();
  const First = await Ship(Paid);
  expect(performance.now() - Started).toBeLessThan(3000);
  expect(First.Status).toBeGreaterThanOrEqual(500);
  Mode = "ok";
  const Second = await Ship(Paid);
  expect(Second.Status).toBe(200);
  expect(Shipments.size).toBe(1);
  expect((await Order(Paid)).TrackingNumber).toBe("TRK1000");
});

test("courier status updates move the order forward", async () => {
  await Ship(Paid);
  expect((await Hook({ EventId: "e1", TrackingNumber: "TRK1000", Status: "picked_up", OccurredAt: "2026-05-01T09:00:00Z" })).Status).toBe(200);
  expect((await Hook({ EventId: "e2", TrackingNumber: "TRK1000", Status: "in_transit", OccurredAt: "2026-05-01T12:00:00Z" })).Status).toBe(200);
  expect((await Order(Paid)).ShipmentStatus).toBe("InTransit");
  expect((await Hook({ EventId: "e3", TrackingNumber: "TRK1000", Status: "delivered", OccurredAt: "2026-05-02T10:00:00Z" })).Status).toBe(200);
  expect((await Order(Paid)).ShipmentStatus).toBe("Delivered");
});

test("late, repeated or forged updates never move the order backwards", async () => {
  await Ship(Paid);
  await Hook({ EventId: "d1", TrackingNumber: "TRK1000", Status: "delivered", OccurredAt: "2026-05-02T10:00:00Z" });
  const Late = await Hook({ EventId: "t1", TrackingNumber: "TRK1000", Status: "in_transit", OccurredAt: "2026-05-01T12:00:00Z" });
  expect(Late.Status).toBeGreaterThanOrEqual(200);
  expect(Late.Status).toBeLessThan(300);
  expect((await Order(Paid)).ShipmentStatus).toBe("Delivered");
  const Repeat = await Hook({ EventId: "d1", TrackingNumber: "TRK1000", Status: "delivered", OccurredAt: "2026-05-02T10:00:00Z" });
  expect(Repeat.Status).toBeGreaterThanOrEqual(200);
  expect(Repeat.Status).toBeLessThan(300);
  const Forged = await Hook({ EventId: "f1", TrackingNumber: "TRK1000", Status: "returned", OccurredAt: "2026-05-03T10:00:00Z" }, "00".repeat(32));
  expect(Forged.Status).toBe(401);
  expect((await Order(Paid)).ShipmentStatus).toBe("Delivered");
});
