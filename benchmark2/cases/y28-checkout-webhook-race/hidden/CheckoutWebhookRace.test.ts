import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { App } from "../../Src/App";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

const Secret = "gw_whsec";
const RealFetch = globalThis.fetch;
type Mode = "webhook-first" | "webhook-after" | "webhook-twice-first" | "timeout-then-webhook" | "plain";
let Mode: Mode = "plain";
let Later: Promise<unknown>[] = [];
let Seq = 0;

function Deliver(Event: Record<string, unknown>) {
  const Raw = JSON.stringify(Event);
  return App.request("/Webhooks/Gateway", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": createHmac("sha256", Secret).update(Raw).digest("hex") },
    body: Raw,
  });
}

function InstallGateway() {
  Later = [];
  globalThis.fetch = (async (Input: any, Init: any = {}) => {
    const Raw = String(Init.body ?? (Input instanceof Request ? await Input.text() : ""));
    const Signal: AbortSignal | undefined = Init.signal ?? (Input instanceof Request ? Input.signal : undefined);
    const Body = JSON.parse(Raw);
    const OrderId = Number(String(Body.Reference).replace(/\D/g, ""));
    const ChargeId = `ch_${++Seq}`;
    const Event = { EventId: `evt_${ChargeId}`, Type: "charge.succeeded", ChargeId, OrderId, Amount: (Body.Amount / 100).toFixed(2) };
    const Ok = () => new Response(JSON.stringify({ Id: ChargeId, Status: "succeeded" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (Mode === "webhook-first") {
      await Deliver(Event);
      return Ok();
    }
    if (Mode === "webhook-twice-first") {
      await Promise.all([Deliver(Event), Deliver({ ...Event })]);
      return Ok();
    }
    if (Mode === "webhook-after") {
      Later.push(new Promise((R) => setTimeout(R, 20)).then(() => Deliver(Event)));
      return Ok();
    }
    if (Mode === "timeout-then-webhook") {
      Later.push(new Promise((R) => setTimeout(R, 400)).then(() => Deliver(Event)));
      return new Promise<Response>((_, Reject) => Signal?.addEventListener("abort", () => Reject(new DOMException("aborted", "AbortError"))));
    }
    return Ok();
  }) as typeof fetch;
}

async function Setting(Key: string, Value: unknown) {
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ($1,$2::jsonb) ON CONFLICT ("Key") DO UPDATE SET "Value" = EXCLUDED."Value"`, [Key, JSON.stringify(Value)]);
}

let A: Awaited<ReturnType<typeof NewCompany>>;
let OrderId: number;

beforeEach(async () => {
  await Reset();
  await Setting("Gateway.BaseUrl", "https://pay.example.test");
  await Setting("Gateway.ApiKey", "gk");
  await Setting("Gateway.TimeoutMs", 150);
  await Setting("Gateway.WebhookSecret", Secret);
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  OrderId = await NewOrder(A.CompanyId, Customer, "114.00");
  InstallGateway();
});

afterEach(() => {
  globalThis.fetch = RealFetch;
});

const Checkout = () => Call("POST", `/Orders/${OrderId}/Checkout`, { Token: A.Token, Body: { CardToken: "tok_visa" } });

async function State() {
  const Payments = await Sql<{ Amount: string; ProviderRef: string }>(`SELECT "Amount"::text AS "Amount", "ProviderRef" FROM "Payments" WHERE "OrderId" = $1`, [OrderId]);
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  return { Status: Order.Status, Payments };
}

test("a plain checkout records one payment", async () => {
  Mode = "plain";
  expect((await Checkout()).Status).toBe(200);
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments).toEqual([{ Amount: "114.00", ProviderRef: "ch_1" }]);
});

test("a webhook that arrives before the gateway answers does not double the payment", async () => {
  Mode = "webhook-first";
  const Res = await Checkout();
  expect(Res.Status).toBe(200);
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments.length).toBe(1);
  expect(S.Payments[0].Amount).toBe("114.00");
});

test("a webhook delivered twice before the answer still gives one payment", async () => {
  Mode = "webhook-twice-first";
  expect((await Checkout()).Status).toBe(200);
  expect((await State()).Payments.length).toBe(1);
});

test("a webhook that arrives after the answer does not double the payment", async () => {
  Mode = "webhook-after";
  expect((await Checkout()).Status).toBe(200);
  await Promise.all(Later);
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments.length).toBe(1);
});

test("when the gateway times out, the later webhook still settles the order once", async () => {
  Mode = "timeout-then-webhook";
  const Res = await Checkout();
  expect(Res.Status).toBeGreaterThanOrEqual(500);
  await Promise.all(Later);
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments.length).toBe(1);
});
