import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewProduct, Reset, Sql } from "./_Support";

beforeEach(async () => {
  await Reset();
});

function Cents(V: string) {
  expect(V).toMatch(/^-?\d+\.\d{2}$/);
  const [I, F] = V.replace("-", "").split(".");
  return (V.startsWith("-") ? -1 : 1) * (Number(I) * 100 + Number(F));
}

async function PlaceOrder(Lines: [string, number, number?][]) {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const Items = [];
  for (const [Price, Quantity, DiscountPercent] of Lines) {
    const ProductId = await NewProduct(A.CompanyId, { Price, Stock: 1000 });
    Items.push(DiscountPercent === undefined ? { ProductId, Quantity } : { ProductId, Quantity, DiscountPercent });
  }
  const Res = await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: Customer, Items } });
  expect(Res.Status).toBe(201);
  return { A, Order: Res.Body.Data };
}

function ExpectTotals(Order: any, Subtotal: string, Discount: string, Tax: string, Total: string) {
  expect([Order.Subtotal, Order.Discount, Order.Tax, Order.Total]).toEqual([Subtotal, Discount, Tax, Total]);
  expect(Cents(Order.Subtotal) - Cents(Order.Discount) + Cents(Order.Tax)).toBe(Cents(Order.Total));
}

test("line discount is rounded half-up to the piaster", async () => {
  const { Order } = await PlaceOrder([["10.05", 1, 10]]);
  ExpectTotals(Order, "10.05", "1.01", "1.27", "10.31");
});

test("each line is rounded on its own before summing", async () => {
  const { Order } = await PlaceOrder([["19.99", 3, 12.5], ["0.35", 7, 15]]);
  ExpectTotals(Order, "62.42", "7.87", "7.64", "62.19");
});

test("the invoice total matches the accountant for a two-unit discounted line", async () => {
  const { Order } = await PlaceOrder([["10.05", 2, 5]]);
  ExpectTotals(Order, "20.10", "1.01", "2.67", "21.76");
});

test("line totals add up to the order net amount", async () => {
  const { Order, A } = await PlaceOrder([["12.45", 7, 7.5], ["4.35", 2, 10], ["9.95", 1, 15], ["10.05", 1, 10]]);
  const Rows = await Sql<{ LineTotal: string }>(`SELECT "LineTotal"::text AS "LineTotal" FROM "OrderItems" WHERE "OrderId" = $1`, [Order.Id]);
  const Sum = Rows.reduce((S, R) => S + Cents(R.LineTotal), 0);
  expect(Sum).toBe(Cents(Order.Subtotal) - Cents(Order.Discount));
  const Fetched = await Call("GET", `/Orders/${Order.Id}`, { Token: A.Token });
  expect(Fetched.Body.Data.Total).toBe(Order.Total);
});

test("orders without discounts keep the old totals", async () => {
  const { Order } = await PlaceOrder([["10.50", 2]]);
  ExpectTotals(Order, "21.00", "0.00", "2.94", "23.94");
});

test("installments that add up exactly mark the order paid", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const OrderId = await NewOrder(A.CompanyId, Customer, "0.30");
  const First = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "0.10", Method: "Cash" } });
  expect(First.Status).toBe(201);
  const Second = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "0.20", Method: "Cash" } });
  expect(Second.Status).toBe(201);
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(Order.Status).toBe("Paid");
});

test("three installments on a 3.30 order mark it paid", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const OrderId = await NewOrder(A.CompanyId, Customer, "3.30");
  for (const Amount of ["1.10", "1.10", "1.10"]) {
    const Res = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount, Method: "Card" } });
    expect(Res.Status).toBe(201);
  }
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(Order.Status).toBe("Paid");
});

test("paying one piaster more than the remainder is still rejected", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const OrderId = await NewOrder(A.CompanyId, Customer, "100.00");
  expect((await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "33.33", Method: "Cash" } })).Status).toBe(201);
  expect((await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "33.33", Method: "Cash" } })).Status).toBe(201);
  const Over = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "33.35", Method: "Cash" } });
  expect(Over.Status).toBe(409);
  expect(Over.Body.Error.Code).toBe("OVERPAYMENT");
  const Exact = await Call("POST", "/Payments", { Token: A.Token, Body: { OrderId, Amount: "33.34", Method: "Cash" } });
  expect(Exact.Status).toBe(201);
  expect(Exact.Body.Data.Amount).toBe("33.34");
  const [Order] = await Sql<{ Status: string }>(`SELECT "Status" FROM "Orders" WHERE "Id" = $1`, [OrderId]);
  expect(Order.Status).toBe("Paid");
});
