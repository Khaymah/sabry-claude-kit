import { afterEach, beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset, Sql } from "./_Support";

type Sent = { Url: string; Headers: Headers; Body: any };
type Reply = Response | "hang" | "network-error";
const RealFetch = globalThis.fetch;
let Calls: Sent[] = [];

function Provider(Replies: (Reply | ((Signal?: AbortSignal | null) => Promise<Response>))[]) {
  Calls = [];
  globalThis.fetch = (async (Input: any, Init: any = {}) => {
    const Url = typeof Input === "string" ? Input : Input instanceof URL ? Input.toString() : Input.url;
    const Headers_ = new Headers(Init.headers ?? (Input instanceof Request ? Input.headers : undefined));
    const Raw = Init.body ?? (Input instanceof Request ? await Input.text() : undefined);
    Calls.push({ Url, Headers: Headers_, Body: Raw ? JSON.parse(String(Raw)) : null });
    const Next = Replies[Math.min(Calls.length - 1, Replies.length - 1)];
    const Signal: AbortSignal | null | undefined = Init.signal ?? (Input instanceof Request ? Input.signal : undefined);
    if (typeof Next === "function") return Next(Signal);
    if (Next === "network-error") throw new TypeError("fetch failed: connection reset");
    if (Next === "hang")
      return new Promise<Response>((_, Reject) => {
        Signal?.addEventListener("abort", () => Reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    return Next.clone();
  }) as typeof fetch;
}

const Json = (Status: number, Body: unknown) => new Response(JSON.stringify(Body), { status: Status, headers: { "Content-Type": "application/json" } });

let A: Awaited<ReturnType<typeof NewCompany>>;
let OrderId: number;

async function Setting(Key: string, Value: unknown) {
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ($1,$2::jsonb) ON CONFLICT ("Key") DO UPDATE SET "Value" = EXCLUDED."Value"`, [Key, JSON.stringify(Value)]);
}

beforeEach(async () => {
  await Reset();
  await Setting("Sms.BaseUrl", "https://sms.example.test");
  await Setting("Sms.ApiKey", "sk_test_123");
  await Setting("Sms.TimeoutMs", 150);
  await Setting("Sms.MaxAttempts", 3);
  await Setting("Sms.RetryDelayMs", 10);
  A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId, { Name: "منى", Phone: "01001234567" });
  OrderId = await NewOrder(A.CompanyId, Customer, "228.00");
});

afterEach(() => {
  globalThis.fetch = RealFetch;
});

const Send = (Id = OrderId, Token = A.Token) => Call("POST", `/Orders/${Id}/SendConfirmation`, { Token });

test("a confirmation is sent once with the order details", async () => {
  Provider([Json(200, { Id: "msg_1" })]);
  const Res = await Send();
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Status: "Sent", Attempts: 1, ProviderMessageId: "msg_1" });
  expect(Calls.length).toBe(1);
  expect(Calls[0].Url).toBe("https://sms.example.test/v1/messages");
  expect(Calls[0].Headers.get("Authorization")).toBe("Bearer sk_test_123");
  expect(Calls[0].Body.To).toBe("01001234567");
  expect(Calls[0].Body.Text).toContain(String(OrderId));
  expect(Calls[0].Body.Text).toContain("228.00");
  expect(typeof Calls[0].Body.Reference).toBe("string");
});

test("server errors are retried with the same reference until success", async () => {
  Provider([Json(503, {}), Json(500, {}), Json(200, { Id: "msg_3" })]);
  const Res = await Send();
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Status: "Sent", Attempts: 3, ProviderMessageId: "msg_3" });
  expect(Calls.length).toBe(3);
  expect(new Set(Calls.map((C) => C.Body.Reference)).size).toBe(1);
});

test("rate limiting and dropped connections are retried", async () => {
  Provider([Json(429, {}), "network-error", Json(200, { Id: "msg_ok" })]);
  const Res = await Send();
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Attempts).toBe(3);
});

test("a rejected request is not retried", async () => {
  Provider([Json(400, { Error: "invalid number" }), Json(200, { Id: "never" })]);
  const Res = await Send();
  expect(Res.Status).toBe(502);
  expect(Res.Body.Success).toBe(false);
  expect(Calls.length).toBe(1);
});

test("a hanging provider is cut off by the timeout on every attempt", async () => {
  await Setting("Sms.MaxAttempts", 2);
  Provider(["hang"]);
  const Started = performance.now();
  const Res = await Send();
  const Elapsed = performance.now() - Started;
  expect(Res.Status).toBe(502);
  expect(Calls.length).toBe(2);
  expect(Elapsed).toBeLessThan(2000);
});

test("giving up after the attempt limit allows a later retry", async () => {
  Provider([Json(500, {})]);
  const Failed = await Send();
  expect(Failed.Status).toBe(502);
  expect(Calls.length).toBe(3);
  Provider([Json(200, { Id: "msg_late" })]);
  const Later = await Send();
  expect(Later.Status).toBe(200);
  expect(Later.Body.Data.ProviderMessageId).toBe("msg_late");
});

test("an order is confirmed only once, even on a double click", async () => {
  Provider([(Signal) => new Promise((R) => setTimeout(() => R(Json(200, { Id: "msg_once" })), 60))]);
  const [First, Second] = await Promise.all([Send(), Send()]);
  expect([First.Status, Second.Status].sort()).toEqual([200, 409]);
  expect(Calls.length).toBe(1);
  const Third = await Send();
  expect(Third.Status).toBe(409);
  expect(Calls.length).toBe(1);
});

test("no provider call for a customer without phone or for another company's order", async () => {
  Provider([Json(200, { Id: "x" })]);
  const NoPhone = await NewCustomer(A.CompanyId, { Name: "بدون رقم" });
  const Order2 = await NewOrder(A.CompanyId, NoPhone, "10.00");
  const Res = await Send(Order2);
  expect(Res.Status).toBe(422);
  const B = await NewCompany();
  expect((await Send(OrderId, B.Token)).Status).toBe(404);
  expect(Calls.length).toBe(0);
});
