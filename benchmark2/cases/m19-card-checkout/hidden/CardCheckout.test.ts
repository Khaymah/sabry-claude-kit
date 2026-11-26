import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

type Mode = "ok" | "decline" | "error503" | "slow" | "hang";
const RealFetch = globalThis.fetch;
let Calls: { Url: string; Key: string | null; Auth: string | null; Body: any }[] = [];
let Plan: Mode[] = [];
let Ledger: Map<string, { Body: string; Charge: string }>;
let Seq = 0;

function InstallGateway(Modes: Mode[]) {
  Calls = [];
  Plan = [...Modes];
  Ledger = new Map();
  globalThis.fetch = (async (Input: any, Init: any = {}) => {
    const Url = typeof Input === "string" ? Input : Input instanceof URL ? Input.toString() : Input.url;
    const Headers_ = new Headers(Init.headers ?? (Input instanceof Request ? Input.headers : undefined));
    const Raw = String(Init.body ?? (Input instanceof Request ? await Input.text() : ""));
    const Signal: AbortSignal | undefined = Init.signal ?? (Input instanceof Request ? Input.signal : undefined);
    const Key = Headers_.get("Idempotency-Key");
    Calls.push({ Url, Key, Auth: Headers_.get("Authorization"), Body: JSON.parse(Raw) });
    const Mode = Plan.length > 1 ? Plan.shift()! : Plan[0];
    const Json = (Status: number, Body: unknown) => new Response(JSON.stringify(Body), { status: Status, headers: { "Content-Type": "application/json" } });
    if (Mode === "hang") return new Promise<Response>((_, Reject) => Signal?.addEventListener("abort", () => Reject(new DOMException("aborted", "AbortError"))));
    if (Mode === "error503") return Json(503, { Error: "unavailable" });
    if (Mode === "decline") return Json(402, { Error: "card_declined" });
    if (Key) {
      const Seen = Ledger.get(Key);
      if (Seen && Seen.Body !== Raw) return Json(422, { Error: "idempotency_key_reused" });
      if (!Seen) Ledger.set(Key, { Body: Raw, Charge: `ch_${++Seq}` });
    } else {
      Ledger.set(`nokey_${++Seq}`, { Body: Raw, Charge: `ch_${Seq}` });
    }
    const Charge = Key ? Ledger.get(Key)!.Charge : `ch_${Seq}`;
    if (Mode === "slow")
      return new Promise<Response>((_, Reject) => Signal?.addEventListener("abort", () => Reject(new DOMException("aborted", "AbortError"))));
    return Json(200, { Id: Charge, Status: "succeeded" });
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
  await Setting("Gateway.ApiKey", "gk_test_1");
  await Setting("Gateway.TimeoutMs", 150);
  await Setting("Gateway.MaxAttempts", 3);
  await Setting("Gateway.RetryDelayMs", 10);
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  OrderId = await NewOrder(A.CompanyId, Customer, "228.50");
});

afterEach(() => {
  globalThis.fetch = RealFetch;
});

const Checkout = (CardToken = "tok_visa", Id = OrderId, Token = A.Token) => Call("POST", `/Orders/${Id}/Checkout`, { Token, Body: { CardToken } });

async function State() {
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  const Payments = await Sql<{ Amount: string; Method: string; ProviderRef: string | null }>(
    `SELECT "Amount"::text AS "Amount", "Method", "ProviderRef" FROM "Payments" WHERE "OrderId" = $1 ORDER BY "Id"`,
    [OrderId],
  );
  return { Status: Order.Status, Payments };
}

test("a successful checkout charges the remaining amount in piasters and marks the order paid", async () => {
  InstallGateway(["ok"]);
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'28.49','Cash')`, [A.CompanyId, OrderId]);
  const Res = await Checkout();
  expect(Res.Status).toBe(200);
  expect(Calls.length).toBe(1);
  expect(Calls[0].Url).toBe("https://pay.example.test/v1/charges");
  expect(Calls[0].Auth).toBe("Bearer gk_test_1");
  expect(Calls[0].Key).toBeTruthy();
  expect(Calls[0].Body).toMatchObject({ Amount: 20001, Currency: "EGP", CardToken: "tok_visa" });
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments[1]).toEqual({ Amount: "200.01", Method: "Card", ProviderRef: "ch_1" });
});

test("transient gateway errors are retried with the same idempotency key", async () => {
  InstallGateway(["error503", "hang", "ok"]);
  const Res = await Checkout();
  expect(Res.Status).toBe(200);
  expect(Calls.length).toBe(3);
  expect(new Set(Calls.map((C) => C.Key)).size).toBe(1);
  expect(Ledger.size).toBe(1);
  expect((await State()).Payments.length).toBe(1);
});

test("when the gateway charged but never answered, the next checkout does not charge again", async () => {
  InstallGateway(["slow"]);
  const Started = performance.now();
  const First = await Checkout();
  expect(performance.now() - Started).toBeLessThan(3000);
  expect(First.Status).toBe(504);
  expect(First.Body.Success).toBe(false);
  expect((await State()).Status).toBe("Pending");
  expect((await State()).Payments.length).toBe(0);
  const KeysBefore = new Set(Calls.map((C) => C.Key));
  Plan = ["ok"];
  const Second = await Checkout();
  expect(Second.Status).toBe(200);
  expect(Ledger.size).toBe(1);
  expect(KeysBefore.has(Calls[Calls.length - 1].Key)).toBe(true);
  const S = await State();
  expect(S.Status).toBe("Paid");
  expect(S.Payments.length).toBe(1);
  expect(S.Payments[0].Amount).toBe("228.50");
});

test("a declined card is not retried and another card can be tried afterwards", async () => {
  InstallGateway(["decline", "ok"]);
  const Declined = await Checkout("tok_bad");
  expect(Declined.Status).toBe(402);
  expect(Declined.Body.Error.Code).toBe("PAYMENT_DECLINED");
  expect(Calls.length).toBe(1);
  expect((await State()).Status).toBe("Pending");
  const Retry = await Checkout("tok_good");
  expect(Retry.Status).toBe(200);
  expect(Calls.length).toBe(2);
  expect(Calls[1].Body.CardToken).toBe("tok_good");
  expect((await State()).Payments.length).toBe(1);
});

test("a double-clicked checkout charges once", async () => {
  InstallGateway(["ok"]);
  const Results = await Promise.all([Checkout(), Checkout(), Checkout()]);
  for (const R of Results) expect([200, 409]).toContain(R.Status);
  expect(Results.some((R) => R.Status === 200)).toBe(true);
  expect(Ledger.size).toBe(1);
  const S = await State();
  expect(S.Payments.length).toBe(1);
  expect(S.Status).toBe("Paid");
});

test("paid or foreign orders never reach the gateway", async () => {
  InstallGateway(["ok"]);
  expect((await Checkout()).Status).toBe(200);
  const Again = await Checkout();
  expect(Again.Status).toBe(409);
  const B = await NewCompany();
  const BCustomer = await NewCustomer(B.CompanyId);
  const BOrder = await NewOrder(B.CompanyId, BCustomer, "10.00");
  expect((await Checkout("tok_visa", BOrder, A.Token)).Status).toBe(404);
  expect(Calls.length).toBe(1);
});
