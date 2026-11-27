import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

type Mode = "ok" | "error503" | "slow";
const RealFetch = globalThis.fetch;
let Calls: { Url: string; Key: string | null; Body: any }[] = [];
let Plan: Mode[] = [];
let Ledger: Map<string, { Body: string; Id: string }>;

function InstallGateway(Modes: Mode[]) {
  Calls = [];
  Plan = [...Modes];
  Ledger = new Map();
  globalThis.fetch = (async (Input: any, Init: any = {}) => {
    const Url = typeof Input === "string" ? Input : Input instanceof URL ? Input.toString() : Input.url;
    const H = new Headers(Init.headers ?? (Input instanceof Request ? Input.headers : undefined));
    const Raw = String(Init.body ?? (Input instanceof Request ? await Input.text() : ""));
    const Signal: AbortSignal | undefined = Init.signal ?? (Input instanceof Request ? Input.signal : undefined);
    const Key = H.get("Idempotency-Key") ?? `nokey-${Calls.length}`;
    Calls.push({ Url, Key: H.get("Idempotency-Key"), Body: JSON.parse(Raw) });
    const Mode = Plan.length > 1 ? Plan.shift()! : Plan[0];
    const Json = (S: number, B: unknown) => new Response(JSON.stringify(B), { status: S, headers: { "Content-Type": "application/json" } });
    if (Mode === "error503") return Json(503, {});
    const Seen = Ledger.get(Key);
    if (Seen && Seen.Body !== Raw) return Json(422, { Error: "idempotency_key_reused" });
    if (!Seen) Ledger.set(Key, { Body: Raw, Id: `re_${Ledger.size + 1}` });
    if (Mode === "slow") return new Promise<Response>((_, Reject) => Signal?.addEventListener("abort", () => Reject(new DOMException("aborted", "AbortError"))));
    return Json(200, { Id: Ledger.get(Key)!.Id });
  }) as typeof fetch;
}

async function Setting(Key: string, Value: unknown) {
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ($1,$2::jsonb) ON CONFLICT ("Key") DO UPDATE SET "Value" = EXCLUDED."Value"`, [Key, JSON.stringify(Value)]);
}

let A: Awaited<ReturnType<typeof NewCompany>>;
let Card: number;
let Cash: number;

beforeEach(async () => {
  await Reset();
  await Setting("Gateway.BaseUrl", "https://pay.example.test");
  await Setting("Gateway.ApiKey", "gk_1");
  await Setting("Gateway.TimeoutMs", 150);
  await Setting("Gateway.MaxAttempts", 3);
  await Setting("Gateway.RetryDelayMs", 10);
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const OrderId = await NewOrder(A.CompanyId, Customer, "114.00", "Paid");
  [{ Id: Card }] = await Sql<{ Id: number }>(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method","ProviderRef") VALUES ($1,$2,'100.00','Card','ch_777') RETURNING "Id"`, [A.CompanyId, OrderId]);
  [{ Id: Cash }] = await Sql<{ Id: number }>(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'14.00','Cash') RETURNING "Id"`, [A.CompanyId, OrderId]);
});

afterEach(() => {
  globalThis.fetch = RealFetch;
});

const Refund = (Amount: string, Id = Card, Token = A.Token) => Call("POST", `/Payments/${Id}/GatewayRefund`, { Token, Body: { Amount } });

test("a refund is sent in piasters against the original charge", async () => {
  InstallGateway(["ok"]);
  const Res = await Refund("25.50");
  expect(Res.Status).toBe(201);
  expect(Calls.length).toBe(1);
  expect(Calls[0].Url).toBe("https://pay.example.test/v1/refunds");
  expect(Calls[0].Key).toBeTruthy();
  expect(Calls[0].Body).toMatchObject({ ChargeId: "ch_777", Amount: 2550 });
});

test("a transient error is retried as the same refund", async () => {
  InstallGateway(["error503", "ok"]);
  expect((await Refund("10.00")).Status).toBe(201);
  expect(Calls.length).toBe(2);
  expect(Calls[0].Key).toBe(Calls[1].Key);
  expect(Ledger.size).toBe(1);
});

test("a refund that went through without an answer is not repeated on retry", async () => {
  InstallGateway(["slow"]);
  const First = await Refund("40.00");
  expect(First.Status).toBeGreaterThanOrEqual(500);
  Plan = ["ok"];
  const Second = await Refund("40.00");
  expect(Second.Status).toBe(201);
  expect(Ledger.size).toBe(1);
  Plan = ["ok"];
  const Rest = await Refund("60.00");
  expect(Rest.Status).toBe(201);
  expect(Ledger.size).toBe(2);
  expect((await Refund("0.01")).Status).toBe(409);
  expect(Ledger.size).toBe(2);
});

test("separate partial refunds are separate gateway refunds", async () => {
  InstallGateway(["ok"]);
  expect((await Refund("10.00")).Status).toBe(201);
  expect((await Refund("20.00")).Status).toBe(201);
  expect((await Refund("10.00")).Status).toBe(201);
  expect(Ledger.size).toBe(3);
  expect(new Set(Calls.map((C) => C.Key)).size).toBe(3);
});

test("over-refunds, cash payments and other companies never reach the gateway", async () => {
  InstallGateway(["ok"]);
  expect((await Refund("100.01")).Status).toBe(409);
  expect((await Refund("5.00", Cash)).Status).toBe(409);
  const B = await NewCompany();
  expect((await Refund("5.00", Card, B.Token)).Status).toBe(404);
  expect(Calls.length).toBe(0);
});
