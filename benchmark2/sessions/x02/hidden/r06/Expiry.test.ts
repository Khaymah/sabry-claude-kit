import { afterEach, expect, test } from "bun:test";
import { Approve, ApprovedQuote, Call, Convert, ConvertOk, Created, Day, GetQuote, NewCompany, NewCustomer, NewProduct, NewUser, QuoteOk, Reset, RestoreClock, Revise, SetClock, StatusOf, StockOf, Submit, SubmitOk } from "../_Support";

afterEach(() => RestoreClock());

test("r06: a quote is valid for 14 days from its latest version, then it is expired", async () => {
  await Reset();
  SetClock(0);
  const A = await NewCompany();
  const C = await NewCustomer(A.Token);
  const P = await NewProduct(A.CompanyId);
  const Q1 = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]);
  const Q2 = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]);
  expect([Day(13), Day(14)]).toContain((await GetQuote(A.Token, Q1)).Body.Data.ValidUntil);
  SetClock(10);
  const Revised = await Revise(A.Token, Q2, [{ ProductId: P, Quantity: 2 }]);
  expect(Created(Revised.Status)).toBe(true);
  expect([Day(23), Day(24)]).toContain((await GetQuote(A.Token, Q2)).Body.Data.ValidUntil);
  SetClock(12);
  expect(await StatusOf(A.Token, Q1)).toBe("Draft");
  SetClock(16);
  expect(await StatusOf(A.Token, Q1)).toBe("Expired");
  expect((await Submit(A.Token, Q1)).Status).toBe(409);
  expect((await Revise(A.Token, Q1, [{ ProductId: P, Quantity: 3 }])).Status).toBe(409);
  expect(await StatusOf(A.Token, Q2)).toBe("Draft");
  SetClock(20);
  expect(await SubmitOk(A.Token, Q2)).toBe("Approved");
  SetClock(26);
  expect(await StatusOf(A.Token, Q2)).toBe("Expired");
  expect((await Convert(A.Token, Q2)).Status).toBe(409);
});

test("r06: approved or pending quotes expire too, converted ones stay converted", async () => {
  await Reset();
  SetClock(0);
  const A = await NewCompany();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const C = await NewCustomer(A.Token);
  const P = await NewProduct(A.CompanyId, { Stock: 10 });
  const Big = await NewProduct(A.CompanyId, { Price: "60000.00", Stock: 10 });
  const Approved = await ApprovedQuote(Sales.Token, C, [{ ProductId: P, Quantity: 2 }]);
  const Pending = await QuoteOk(Sales.Token, C, [{ ProductId: Big, Quantity: 1 }]);
  expect(await SubmitOk(Sales.Token, Pending)).toBe("PendingApproval");
  const Done = await ApprovedQuote(Sales.Token, C, [{ ProductId: P, Quantity: 1 }]);
  await ConvertOk(Sales.Token, Done);
  SetClock(16);
  expect(await StatusOf(A.Token, Approved)).toBe("Expired");
  expect((await Convert(A.Token, Approved)).Status).toBe(409);
  expect(await StockOf(A.Token, P)).toBe(9);
  expect(await StatusOf(A.Token, Pending)).toBe("Expired");
  expect((await Approve(A.Token, Pending)).Status).toBe(409);
  expect(await StatusOf(A.Token, Done)).toBe("Converted");
  expect(await StockOf(A.Token, Big)).toBe(10);
});

test("r06: a new validity applies from now on, only the owner sets it, per company", async () => {
  await Reset();
  SetClock(0);
  const A = await NewCompany();
  const B = await NewCompany();
  const Admin = await NewUser(A.CompanyId, "Admin");
  const C = await NewCustomer(A.Token);
  const BC = await NewCustomer(B.Token);
  const P = await NewProduct(A.CompanyId);
  const BP = await NewProduct(B.CompanyId);
  const Before = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]);
  expect((await Call("PUT", "/QuoteSettings", { Token: Admin.Token, Body: { ValidityDays: 30 } })).Status).toBe(403);
  for (const ValidityDays of [0, -1, 1.5, 366, 1e12]) {
    expect((await Call("PUT", "/QuoteSettings", { Token: A.Token, Body: { ValidityDays } })).Status).toBe(400);
  }
  expect(Created((await Call("PUT", "/QuoteSettings", { Token: A.Token, Body: { ValidityDays: 30 } })).Status)).toBe(true);
  const After = await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]);
  const Other = await QuoteOk(B.Token, BC, [{ ProductId: BP, Quantity: 1 }]);
  SetClock(20);
  expect(await StatusOf(A.Token, Before)).toBe("Expired");
  expect(await StatusOf(A.Token, After)).toBe("Draft");
  expect(await StatusOf(B.Token, Other)).toBe("Expired");
  SetClock(25);
  const Late = await QuoteOk(B.Token, BC, [{ ProductId: BP, Quantity: 1 }]);
  SetClock(35);
  expect(await StatusOf(A.Token, After)).toBe("Expired");
  expect(await StatusOf(B.Token, Late)).toBe("Draft");
});
