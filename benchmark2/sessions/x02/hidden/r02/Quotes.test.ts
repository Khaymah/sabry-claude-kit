import { expect, test } from "bun:test";
import { Call, Created, Day, GetQuote, Money, NewCompany, NewCustomer, NewProduct, NewQuote, NewUser, PriceListOk, QuoteOk, Reset } from "../_Support";

test("r02: a quote prices each line from the customer's list and rounds every amount half up", async () => {
  await Reset();
  const A = await NewCompany();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const C = await NewCustomer(A.Token);
  const P1 = await NewProduct(A.CompanyId, { Price: "99.00" });
  const P2 = await NewProduct(A.CompanyId, { Price: "33.32" });
  await PriceListOk(A.Token, C, Day(-5), Day(5), [{ ProductId: P1, Price: "10.04" }]);
  const Res = await NewQuote(Sales.Token, C, [
    { ProductId: P1, Quantity: 1, DiscountPercent: 12.5 },
    { ProductId: P2, Quantity: 3 },
  ]);
  expect(Created(Res.Status)).toBe(true);
  const Q = Res.Body.Data;
  expect(Q.Status).toBe("Draft");
  expect(Number(Q.Version)).toBe(1);
  const L1 = Q.Items.find((I: any) => Number(I.ProductId) === P1);
  const L2 = Q.Items.find((I: any) => Number(I.ProductId) === P2);
  expect([Money(L1.UnitPrice), Money(L1.LineTotal), Number(L1.Quantity)]).toEqual(["10.04", "8.79", 1]);
  expect([Money(L2.UnitPrice), Money(L2.LineTotal), Number(L2.Quantity)]).toEqual(["33.32", "99.96", 3]);
  expect([Money(Q.Subtotal), Money(Q.Tax), Money(Q.Total)]).toEqual(["108.75", "15.23", "123.98"]);
  const Read = await GetQuote(A.Token, Q.Id);
  expect(Read.Status).toBe(200);
  expect(Read.Body.Data.Status).toBe("Draft");
  expect([Money(Read.Body.Data.Subtotal), Money(Read.Body.Data.Tax), Money(Read.Body.Data.Total)]).toEqual(["108.75", "15.23", "123.98"]);
  expect(Read.Body.Data.Items.length).toBe(2);
});

test("r02: quote prices are a snapshot of the day the quote was made", async () => {
  await Reset();
  const A = await NewCompany();
  const C = await NewCustomer(A.Token);
  const P = await NewProduct(A.CompanyId, { Price: "200.00" });
  const Q = await NewProduct(A.CompanyId, { Price: "40.00" });
  await PriceListOk(A.Token, C, Day(-1), undefined, [{ ProductId: P, Price: "150.00" }]);
  const Id = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 2 }, { ProductId: Q, Quantity: 1, DiscountPercent: 10 }]);
  await PriceListOk(A.Token, C, Day(-1), undefined, [{ ProductId: P, Price: "120.00" }, { ProductId: Q, Price: "30.00" }]);
  expect((await Call("PATCH", `/Products/${P}`, { Token: A.Token, Body: { Price: "250.00" } })).Status).toBe(200);
  const Read = (await GetQuote(A.Token, Id)).Body.Data;
  expect(Money(Read.Items.find((I: any) => Number(I.ProductId) === P).UnitPrice)).toBe("150.00");
  expect(Money(Read.Items.find((I: any) => Number(I.ProductId) === Q).LineTotal)).toBe("36.00");
  expect([Money(Read.Subtotal), Money(Read.Tax), Money(Read.Total)]).toEqual(["336.00", "47.04", "383.04"]);
  const Fresh = (await GetQuote(A.Token, await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]))).Body.Data;
  expect(Money(Fresh.Items[0].UnitPrice)).toBe("120.00");
});

test("r02: bad quotes are refused and other companies' data is not found", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const C = await NewCustomer(A.Token);
  const BC = await NewCustomer(B.Token);
  const P = await NewProduct(A.CompanyId);
  const BP = await NewProduct(B.CompanyId);
  for (const Quantity of [0, -1, 1.5, 1e12]) {
    expect((await NewQuote(A.Token, C, [{ ProductId: P, Quantity }])).Status).toBe(400);
  }
  for (const DiscountPercent of [-1, 30.5, 100]) {
    expect((await NewQuote(A.Token, C, [{ ProductId: P, Quantity: 1, DiscountPercent }])).Status).toBe(400);
  }
  expect([400, 409, 422]).toContain((await NewQuote(A.Token, C, [{ ProductId: P, Quantity: 1e9 }])).Status);
  expect((await NewQuote(A.Token, C, [])).Status).toBe(400);
  expect([400, 404]).toContain((await NewQuote(A.Token, BC, [{ ProductId: P, Quantity: 1 }])).Status);
  expect([400, 404]).toContain((await NewQuote(A.Token, C, [{ ProductId: P, Quantity: 1 }, { ProductId: BP, Quantity: 1 }])).Status);
  expect([400, 404]).toContain((await NewQuote(A.Token, C, [{ ProductId: 1e12, Quantity: 1 }])).Status);
  expect([400, 404]).toContain((await NewQuote(A.Token, 1e12, [{ ProductId: P, Quantity: 1 }])).Status);
  const Id = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]);
  expect((await GetQuote(B.Token, Id)).Status).toBe(404);
  expect((await Call("GET", "/Quotes/99999999999", { Token: A.Token })).Status).toBe(404);
  expect((await Call("GET", `/Quotes/${Id}`)).Status).toBe(401);
});
