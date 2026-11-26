import { beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

const Secret = "whsec_race";
let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;
let Product: number;

beforeEach(async () => {
  await Reset();
  await Sql(`INSERT INTO "SystemSettings" ("Key","Value") VALUES ('PaymentProvider.WebhookSecret', $1::jsonb)`, [JSON.stringify(Secret)]);
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  Product = await NewProduct(A.CompanyId, { Price: "100.00", Stock: 1000 });
});

async function PlaceOrder() {
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 2 }] } });
  expect(Res.Status).toBe(201);
  return { Id: Res.Body.Data.Id as number, Total: Res.Body.Data.Total as string };
}

function Deliver(OrderId: number, Amount: string, EventId = `evt_${OrderId}`) {
  const Raw = JSON.stringify({ EventId, Type: "payment.succeeded", OrderId, Amount, ProviderRef: `ch_${OrderId}` });
  return Call("POST", "/Webhooks/Payments", {
    RawBody: Raw,
    Headers: { "Content-Type": "application/json", "X-Signature": createHmac("sha256", Secret).update(Raw).digest("hex") },
  });
}

const Cancel = (Id: number) => Call("POST", `/Orders/${Id}/Cancel`, { Token: A.Token });

async function Stock() {
  const [Row] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [Product]);
  return Row.Stock;
}

async function Check(Id: number) {
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [Id]);
  const Payments = await Sql<{ Status: string }>(`SELECT "Status" FROM "Payments" WHERE "OrderId" = $1`, [Id]);
  expect(Payments.length).toBe(1);
  if (Order.Status === "Cancelled") expect(Payments[0].Status).not.toBe("Completed");
  else {
    expect(Order.Status).toBe("Paid");
    expect(Payments[0].Status).toBe("Completed");
  }
  return Order.Status;
}

async function After<T>(Ticks: number, Fn: () => Promise<T>) {
  for (let I = 0; I < Ticks; I++) await Promise.resolve();
  return Fn();
}

test("cancel and payment arriving together always leave a consistent order", async () => {
  for (let I = 0; I < 60; I++) {
    const O = await PlaceOrder();
    const StockBefore = await Stock();
    const Ticks = Math.floor(I / 2) * 7;
    const Hook =
      I % 2 === 0
        ? (await Promise.all([Deliver(O.Id, O.Total), After(Ticks, () => Cancel(O.Id))]))[0]
        : (await Promise.all([Cancel(O.Id), After(Ticks, () => Deliver(O.Id, O.Total))]))[1];
    expect(Hook.Status).toBeGreaterThanOrEqual(200);
    expect(Hook.Status).toBeLessThan(300);
    const Status = await Check(O.Id);
    expect([I, await Stock()]).toEqual([I, Status === "Cancelled" ? StockBefore + 2 : StockBefore]);
  }
}, 60000);

test("a payment for an already cancelled order is kept for refund", async () => {
  const O = await PlaceOrder();
  expect((await Cancel(O.Id)).Status).toBe(200);
  expect((await Deliver(O.Id, O.Total)).Status).toBe(200);
  expect(await Check(O.Id)).toBe("Cancelled");
  const [P] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Payments" WHERE "OrderId" = $1`, [O.Id]);
  expect(P.Status).toBe("RefundDue");
});

test("a paid order cannot be cancelled afterwards", async () => {
  const O = await PlaceOrder();
  const StockBefore = await Stock();
  expect((await Deliver(O.Id, O.Total)).Status).toBe(200);
  expect((await Cancel(O.Id)).Status).toBe(409);
  expect(await Check(O.Id)).toBe("Paid");
  expect(await Stock()).toBe(StockBefore);
});
