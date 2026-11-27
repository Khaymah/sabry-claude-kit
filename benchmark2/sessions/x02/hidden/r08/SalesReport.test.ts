import { expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { ApprovedQuote, Call, ConvertOk, Day, ListOf, Money, NewCompany, NewCustomer, NewProduct, NewUser, PriceListOk, QuoteOk, Reset } from "../_Support";

async function Report(Token: string) {
  const Res = await Call("GET", "/Reports/SalesBySalesperson", { Token });
  return { Status: Res.Status, Items: ListOf(Res.Body?.Data), Text: Res.Text };
}

const RowOf = (Items: any[], UserId: number) => Items.find((I: any) => Number(I.UserId) === UserId);

test("r08: each salesperson's real sales, a cancelled order no longer counts", async () => {
  await Reset();
  const A = await NewCompany();
  const S1 = await NewUser(A.CompanyId, "Staff");
  const S2 = await NewUser(A.CompanyId, "Staff");
  const C = await NewCustomer(A.Token);
  const P1 = await NewProduct(A.CompanyId, { Price: "99.00", Stock: 100 });
  const P2 = await NewProduct(A.CompanyId, { Price: "33.32", Stock: 100 });
  await PriceListOk(A.Token, C, Day(-2), undefined, [{ ProductId: P1, Price: "10.04" }]);
  const Kept = await ApprovedQuote(S1.Token, C, [{ ProductId: P1, Quantity: 1, DiscountPercent: 12.5 }, { ProductId: P2, Quantity: 3 }]);
  await ConvertOk(S1.Token, Kept);
  const Dropped = await ApprovedQuote(S1.Token, C, [{ ProductId: P2, Quantity: 10 }]);
  const DroppedOrder = await ConvertOk(S1.Token, Dropped);
  await QuoteOk(S1.Token, C, [{ ProductId: P2, Quantity: 1 }]);
  await ApprovedQuote(S1.Token, C, [{ ProductId: P2, Quantity: 2 }]);
  const Other = await ApprovedQuote(S2.Token, C, [{ ProductId: P1, Quantity: 50 }]);
  await ConvertOk(S2.Token, Other);
  expect((await Call("POST", "/Orders", { Token: A.Token, Body: { CustomerId: C, Items: [{ ProductId: P2, Quantity: 5 }] } })).Status).toBe(201);
  const Before = await Report(A.Token);
  expect(Before.Status).toBe(200);
  expect(Money(RowOf(Before.Items, S1.UserId).SalesTotal)).toBe("503.83");
  expect((await Call("POST", `/Orders/${DroppedOrder}/Cancel`, { Token: A.Token })).Status).toBe(200);
  const After = await Report(A.Token);
  const R1 = RowOf(After.Items, S1.UserId);
  const R2 = RowOf(After.Items, S2.UserId);
  expect([Number(R1.QuotesCount), Number(R1.OrdersCount), Money(R1.SalesTotal)]).toEqual([4, 1, "123.98"]);
  expect([Number(R2.QuotesCount), Number(R2.OrdersCount), Money(R2.SalesTotal)]).toEqual([1, 1, "572.28"]);
  expect(Number(RowOf(After.Items, A.UserId)?.SalesTotal ?? 0)).toBe(0);
  expect(After.Items.map((I: any) => Number(I.UserId)).slice(0, 2)).toEqual([S2.UserId, S1.UserId]);
});

test("r08: the report shows this company's salespeople only", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const SA = await NewUser(A.CompanyId, "Staff");
  const SB = await NewUser(B.CompanyId, "Staff");
  const C = await NewCustomer(A.Token);
  const BC = await NewCustomer(B.Token);
  const P = await NewProduct(A.CompanyId, { Price: "10.00" });
  const BP = await NewProduct(B.CompanyId, { Price: "1000.00" });
  await ConvertOk(SA.Token, await ApprovedQuote(SA.Token, C, [{ ProductId: P, Quantity: 2 }]));
  await ConvertOk(SB.Token, await ApprovedQuote(SB.Token, BC, [{ ProductId: BP, Quantity: 3 }]));
  await QuoteOk(B.Token, BC, [{ ProductId: BP, Quantity: 1 }]);
  const Res = await Report(A.Token);
  expect(Res.Status).toBe(200);
  expect(Res.Items.length).toBe(1);
  expect(Number(Res.Items[0].UserId)).toBe(SA.UserId);
  expect(Res.Items[0].Name).toBe(SA.Name);
  expect(Money(Res.Items[0].SalesTotal)).toBe("22.80");
  expect(Res.Text).not.toContain(SB.Name);
  const BRes = await Report(B.Token);
  expect(Money(RowOf(BRes.Items, SB.UserId).SalesTotal)).toBe("3420.00");
  expect(Number(RowOf(BRes.Items, B.UserId).QuotesCount)).toBe(1);
  expect((await Call("GET", "/Reports/SalesBySalesperson")).Status).toBe(401);
});

test("r08: the report over many salespeople and quotes stays within a small query budget", async () => {
  await Reset();
  const A = await NewCompany();
  const C = await NewCustomer(A.Token);
  const P = await NewProduct(A.CompanyId, { Price: "10.00", Stock: 100000 });
  const People: { UserId: number; Token: string }[] = [];
  for (let I = 0; I < 12; I++) People.push(await NewUser(A.CompanyId, "Staff"));
  for (let I = 0; I < People.length; I++) {
    for (let J = 0; J < 3; J++) {
      const Id = await ApprovedQuote(People[I].Token, C, [{ ProductId: P, Quantity: I + 1 }]);
      if (J < 2) await ConvertOk(People[I].Token, Id);
    }
  }
  QueryStats.Reset();
  const Res = await Report(A.Token);
  expect(Res.Status).toBe(200);
  expect(QueryStats.Count).toBeLessThanOrEqual(8);
  expect(Res.Items.length).toBe(12);
  const Row = RowOf(Res.Items, People[4].UserId);
  expect([Number(Row.QuotesCount), Number(Row.OrdersCount), Money(Row.SalesTotal)]).toEqual([3, 2, "114.00"]);
  expect(Number(Res.Items[0].UserId)).toBe(People[11].UserId);
}, 120000);
