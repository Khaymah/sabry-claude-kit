import { expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { Call, Created, Day, NewCompany, NewCustomer, NewProduct, PriceList, PriceListOk, Prices, Reset } from "../_Support";

test("r01: each product gets the customer's price for the asked day, newest list wins", async () => {
  await Reset();
  const A = await NewCompany();
  const C1 = await NewCustomer(A.Token);
  const C2 = await NewCustomer(A.Token);
  const P1 = await NewProduct(A.CompanyId, { Price: "100.00" });
  const P2 = await NewProduct(A.CompanyId, { Price: "50.00" });
  const P3 = await NewProduct(A.CompanyId, { Price: "20.00" });
  const First = await PriceList(A.Token, C1, Day(-10), Day(10), [{ ProductId: P1, Price: "80.00" }]);
  expect(Created(First.Status)).toBe(true);
  expect(typeof First.Body.Data.Id).toBe("number");
  await PriceListOk(A.Token, C1, Day(-3), undefined, [{ ProductId: P1, Price: "75.50" }, { ProductId: P2, Price: 45 }]);
  await PriceListOk(A.Token, C1, Day(-40), Day(-30), [{ ProductId: P3, Price: "11.00" }]);
  await PriceListOk(A.Token, C1, Day(20), Day(25), [{ ProductId: P3, Price: "12.25" }, { ProductId: P1, Price: "60.00" }]);
  await PriceListOk(A.Token, C2, Day(-5), Day(5), [{ ProductId: P3, Price: "1.00" }]);

  const Now = await Prices(A.Token, C1);
  expect(Now.Status).toBe(200);
  expect([Now.Map.get(P1), Now.Map.get(P2), Now.Map.get(P3)]).toEqual(["75.50", "45.00", "20.00"]);
  const Ahead = await Prices(A.Token, C1, Day(25));
  expect([Ahead.Map.get(P1), Ahead.Map.get(P2), Ahead.Map.get(P3)]).toEqual(["60.00", "45.00", "12.25"]);
  const Later = await Prices(A.Token, C1, Day(26));
  expect([Later.Map.get(P1), Later.Map.get(P3)]).toEqual(["75.50", "20.00"]);
  const Before = await Prices(A.Token, C1, Day(-6));
  expect([Before.Map.get(P1), Before.Map.get(P2)]).toEqual(["80.00", "50.00"]);
  const Old = await Prices(A.Token, C1, Day(-30));
  expect([Old.Map.get(P1), Old.Map.get(P3)]).toEqual(["100.00", "11.00"]);
  const Other = await Prices(A.Token, C2, Day(0));
  expect([Other.Map.get(P1), Other.Map.get(P3)]).toEqual(["100.00", "1.00"]);
});

test("r01: bad price lists are refused whole and create nothing", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const C = await NewCustomer(A.Token);
  const BC = await NewCustomer(B.Token);
  const P = await NewProduct(A.CompanyId, { Price: "100.00" });
  const Q = await NewProduct(A.CompanyId, { Price: "30.00" });
  const BP = await NewProduct(B.CompanyId);
  const Bad: unknown[] = [0, -5, "12.345", 12.345, 1e12, "abc"];
  for (const Price of Bad) {
    expect((await PriceList(A.Token, C, Day(-1), Day(1), [{ ProductId: P, Price }])).Status).toBe(400);
  }
  expect((await PriceList(A.Token, C, Day(5), Day(1), [{ ProductId: P, Price: "10.00" }])).Status).toBe(400);
  expect((await PriceList(A.Token, C, "2026-02-30", undefined, [{ ProductId: P, Price: "10.00" }])).Status).toBe(400);
  expect((await PriceList(A.Token, C, Day(-1), undefined, [])).Status).toBe(400);
  expect([400, 404]).toContain((await PriceList(A.Token, C, Day(-1), undefined, [{ ProductId: Q, Price: "10.00" }, { ProductId: BP, Price: "10.00" }])).Status);
  expect([400, 404]).toContain((await PriceList(A.Token, C, Day(-1), undefined, [{ ProductId: Q, Price: "10.00" }, { ProductId: 1e12, Price: "10.00" }])).Status);
  expect([400, 404]).toContain((await PriceList(A.Token, BC, Day(-1), undefined, [{ ProductId: Q, Price: "10.00" }])).Status);
  expect([400, 404]).toContain((await PriceList(A.Token, 1e12, Day(-1), undefined, [{ ProductId: Q, Price: "10.00" }])).Status);
  const After = await Prices(A.Token, C, Day(0));
  expect([After.Map.get(P), After.Map.get(Q)]).toEqual(["100.00", "30.00"]);
  expect(After.Map.has(BP)).toBe(false);
  expect((await Call("GET", `/Customers/${BC}/Prices`, { Token: A.Token })).Status).toBe(404);
  expect((await Call("GET", `/Customers/99999999999/Prices`, { Token: A.Token })).Status).toBe(404);
  expect((await Call("GET", `/Customers/${C}/Prices?Date=yesterday`, { Token: A.Token })).Status).toBe(400);
});

test("r01: the price sheet of a big catalogue stays within a small query budget", async () => {
  await Reset();
  const A = await NewCompany();
  const C = await NewCustomer(A.Token);
  const Ps: number[] = [];
  for (let I = 0; I < 150; I++) Ps.push(await NewProduct(A.CompanyId, { Price: `${100 + I}.00` }));
  await PriceListOk(A.Token, C, Day(-10), undefined, Ps.slice(0, 60).map((ProductId) => ({ ProductId, Price: "9.99" })));
  await PriceListOk(A.Token, C, Day(-2), Day(2), Ps.slice(40, 90).map((ProductId) => ({ ProductId, Price: "7.50" })));
  QueryStats.Reset();
  const Sheet = await Prices(A.Token, C, Day(0));
  expect(Sheet.Status).toBe(200);
  expect(QueryStats.Count).toBeLessThanOrEqual(6);
  expect(Sheet.Map.size).toBe(150);
  expect(Sheet.Map.get(Ps[0])).toBe("9.99");
  expect(Sheet.Map.get(Ps[45])).toBe("7.50");
  expect(Sheet.Map.get(Ps[89])).toBe("7.50");
  expect(Sheet.Map.get(Ps[120])).toBe("220.00");
}, 60000);
