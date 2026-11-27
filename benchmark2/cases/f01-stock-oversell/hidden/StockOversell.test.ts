import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewProduct, Reset, Sql } from "./_Support";

beforeEach(async () => {
  await Reset();
});

async function Stock(ProductId: number) {
  const [Row] = await Sql<{ Stock: number }>(`SELECT "Stock" FROM "Products" WHERE "Id" = $1`, [ProductId]);
  return Row.Stock;
}

async function SoldQuantity(ProductId: number) {
  const [Row] = await Sql<{ Q: string }>(
    `SELECT coalesce(sum(i."Quantity"),0)::text AS "Q" FROM "OrderItems" i JOIN "Orders" o ON o."Id" = i."OrderId" WHERE i."ProductId" = $1 AND o."Status" <> 'Cancelled'`,
    [ProductId],
  );
  return Number(Row.Q);
}

test("concurrent orders never sell more than the stock", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const Product = await NewProduct(A.CompanyId, { Stock: 5, Price: "20.00" });
  const Results = await Promise.all(
    Array.from({ length: 12 }, () =>
      Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 1 }] } }),
    ),
  );
  const Created = Results.filter((R) => R.Status === 201);
  const Rejected = Results.filter((R) => R.Status === 409);
  expect(Created.length).toBe(5);
  expect(Rejected.length).toBe(7);
  for (const R of Rejected) expect(R.Body.Error.Code).toBe("OUT_OF_STOCK");
  expect(await Stock(Product)).toBe(0);
  expect(await SoldQuantity(Product)).toBe(5);
});

test("concurrent multi-line orders keep every product consistent", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const P1 = await NewProduct(A.CompanyId, { Stock: 4 });
  const P2 = await NewProduct(A.CompanyId, { Stock: 6 });
  const Results = await Promise.all(
    Array.from({ length: 8 }, (_, I) =>
      Call("POST", "/Orders", {
        Token: A.Token,
        Body: { CustomerId: Customer, Items: [{ ProductId: P1, Quantity: 1 }, { ProductId: P2, Quantity: 2 }].slice(I % 2) },
      }),
    ),
  );
  expect(Results.every((R) => R.Status === 201 || R.Status === 409)).toBe(true);
  expect((await Stock(P1)) + (await SoldQuantity(P1))).toBe(4);
  expect((await Stock(P2)) + (await SoldQuantity(P2))).toBe(6);
  expect(await Stock(P1)).toBeGreaterThanOrEqual(0);
  expect(await Stock(P2)).toBeGreaterThanOrEqual(0);
  expect(await SoldQuantity(P2)).toBe(6);
});

test("a rejected order changes nothing", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const P1 = await NewProduct(A.CompanyId, { Stock: 10 });
  const P2 = await NewProduct(A.CompanyId, { Stock: 1 });
  const Res = await Call("POST", "/Orders", {
    Token: A.Token,
    Body: { CustomerId: Customer, Items: [{ ProductId: P1, Quantity: 3 }, { ProductId: P2, Quantity: 2 }] },
  });
  expect(Res.Status).toBe(409);
  expect(Res.Body.Error.Code).toBe("OUT_OF_STOCK");
  expect(await Stock(P1)).toBe(10);
  expect(await Stock(P2)).toBe(1);
  const [Count] = await Sql<{ N: number }>(`SELECT count(*)::int AS "N" FROM "Orders"`);
  expect(Count.N).toBe(0);
});

test("orders and cancellations running together keep stock exact", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const Product = await NewProduct(A.CompanyId, { Stock: 10 });
  const First = await Promise.all(
    Array.from({ length: 4 }, () =>
      Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 2 }] } }),
    ),
  );
  expect(First.every((R) => R.Status === 201)).toBe(true);
  const Mixed = await Promise.all([
    Call("POST", `/Orders/${First[0].Body.Data.Id}/Cancel`, { Token: A.Token }),
    Call("POST", `/Orders/${First[1].Body.Data.Id}/Cancel`, { Token: A.Token }),
    ...Array.from({ length: 4 }, () =>
      Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 1 }] } }),
    ),
  ]);
  expect(Mixed[0].Status).toBe(200);
  expect(Mixed[1].Status).toBe(200);
  expect((await Stock(Product)) + (await SoldQuantity(Product))).toBe(10);
});

test("normal ordering and cancelling still work", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const Product = await NewProduct(A.CompanyId, { Stock: 3, Price: "10.50" });
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items: [{ ProductId: Product, Quantity: 2 }] } });
  expect(Res.Status).toBe(201);
  expect(Res.Body.Data.Total).toBe("23.94");
  expect(await Stock(Product)).toBe(1);
  const Cancel = await Call("POST", `/Orders/${Res.Body.Data.Id}/Cancel`, { Token: A.Token });
  expect(Cancel.Status).toBe(200);
  expect(await Stock(Product)).toBe(3);
  const Again = await Call("POST", `/Orders/${Res.Body.Data.Id}/Cancel`, { Token: A.Token });
  expect(Again.Status).toBe(409);
  expect(await Stock(Product)).toBe(3);
});
