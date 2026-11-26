import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Customer: number;
let P1: number;
let P2: number;
let OrderId: number;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Customer = await NewCustomer(A.CompanyId);
  P1 = await NewProduct(A.CompanyId, { Price: "10.00", Stock: 10 });
  P2 = await NewProduct(A.CompanyId, { Price: "2.50", Stock: 4 });
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: P1, Quantity: 2 }] } });
  expect(Res.Status).toBe(201);
  OrderId = Res.Body.Data.Id;
});

const Edit = (Body: unknown, Id = OrderId, Token = A.Token) => Call("PATCH", `/Orders/${Id}/Items`, { Token, Body });
const EditRaw = (Raw: string) => Call("PATCH", `/Orders/${OrderId}/Items`, { Token: A.Token, RawBody: Raw, Headers: { "Content-Type": "application/json" } });

async function Snapshot() {
  const Stock = await Sql(`SELECT "Id", "Stock" FROM "Products" ORDER BY "Id"`);
  const Order = await Sql(`SELECT "Subtotal"::text AS "Subtotal", "Tax"::text AS "Tax", "Total"::text AS "Total", "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  const Items = await Sql(`SELECT "ProductId", "Quantity" FROM "OrderItems" WHERE "OrderId" = $1 ORDER BY "ProductId"`, [OrderId]);
  return { Stock, Order, Items };
}

test("editing lines moves stock and recalculates totals", async () => {
  const Res = await Edit({ Items: [{ ProductId: P1, Quantity: 5 }, { ProductId: P2, Quantity: 2 }], Note: "اتصل قبل التوصيل" });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Subtotal: "55.00", Tax: "7.70", Total: "62.70" });
  const S = await Snapshot();
  expect(S.Stock).toEqual([{ Id: P1, Stock: 5 }, { Id: P2, Stock: 2 }]);
  expect(S.Items).toEqual([{ ProductId: P1, Quantity: 5 }, { ProductId: P2, Quantity: 2 }]);
  const Back = await Edit({ Items: [{ ProductId: P2, Quantity: 1 }] });
  expect(Back.Status).toBe(200);
  expect((await Snapshot()).Stock).toEqual([{ Id: P1, Stock: 10 }, { Id: P2, Stock: 3 }]);
});

test("malformed lines are validation errors and change nothing", async () => {
  const Before = await Snapshot();
  const Bad: unknown[] = [
    { Items: [] },
    { Items: [{ ProductId: P1, Quantity: 0 }] },
    { Items: [{ ProductId: P1, Quantity: -1 }] },
    { Items: [{ ProductId: P1, Quantity: 1.5 }] },
    { Items: [{ ProductId: P1, Quantity: "2" }] },
    { Items: [{ ProductId: P1, Quantity: 1001 }] },
    { Items: [{ ProductId: P1, Quantity: 1e308 }] },
    { Items: [{ ProductId: 0, Quantity: 1 }] },
    { Items: [{ ProductId: "1", Quantity: 1 }] },
    { Items: Array.from({ length: 101 }, (_, I) => ({ ProductId: I + 1, Quantity: 1 })) },
    { Items: [{ ProductId: P1, Quantity: 1 }], Note: "x".repeat(501) },
    { Items: "all" },
    {},
  ];
  for (const Body of Bad) {
    const Res = await Edit(Body);
    expect([JSON.stringify(Body).slice(0, 80), Res.Status]).toEqual([JSON.stringify(Body).slice(0, 80), 400]);
  }
  expect((await EditRaw("{not json")).Status).toBe(400);
  expect(await Snapshot()).toEqual(Before);
});

test("absurd product ids never crash the server", async () => {
  for (const ProductId of [99999999999, 2 ** 53 - 1, 2147483648]) {
    const Res = await Edit({ Items: [{ ProductId, Quantity: 1 }] });
    expect([400, 404]).toContain(Res.Status);
  }
  const Missing = await Edit({ Items: [{ ProductId: 2147483647, Quantity: 1 }] });
  expect(Missing.Status).toBe(404);
});

test("orders over one million are refused, and stock shortages change nothing", async () => {
  const Lux = await NewProduct(A.CompanyId, { Price: "500000.00", Stock: 10 });
  const Before = await Snapshot();
  const Huge = await Edit({ Items: [{ ProductId: Lux, Quantity: 2 }] });
  expect(Huge.Status).toBe(422);
  expect(Huge.Body.Error.Code).toBe("ORDER_TOO_LARGE");
  const Short = await Edit({ Items: [{ ProductId: P1, Quantity: 3 }, { ProductId: P2, Quantity: 5 }] });
  expect(Short.Status).toBe(409);
  expect(Short.Body.Error.Code).toBe("OUT_OF_STOCK");
  expect(await Snapshot()).toEqual(Before);
});

test("only pending unpaid orders of the caller's company can be edited", async () => {
  const B = await NewCompany();
  expect((await Edit({ Items: [{ ProductId: P1, Quantity: 1 }] }, OrderId, B.Token)).Status).toBe(404);
  const BProduct = await NewProduct(B.CompanyId, { Stock: 5 });
  expect((await Edit({ Items: [{ ProductId: BProduct, Quantity: 1 }] })).Status).toBe(404);
  expect((await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "1.00", Method: "Cash" } })).Status).toBe(201);
  expect((await Edit({ Items: [{ ProductId: P1, Quantity: 1 }] })).Status).toBe(409);
});
