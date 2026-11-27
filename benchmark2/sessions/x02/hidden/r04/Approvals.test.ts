import { expect, test } from "bun:test";
import { Approve, Created, GetQuote, Money, NewCompany, NewCustomer, NewProduct, NewUser, QuoteOk, Reset, Revise, StatusOf, Submit, SubmitOk } from "../_Support";

async function Setup() {
  await Reset();
  const A = await NewCompany();
  const C = await NewCustomer(A.Token);
  const Exact = await NewProduct(A.CompanyId, { Price: "43859.65" });
  const Over = await NewProduct(A.CompanyId, { Price: "43859.66" });
  return { A, C, Exact, Over };
}

test("r04: up to 50,000 including tax is approved on submit, above it waits for approval", async () => {
  const { A, C, Exact, Over } = await Setup();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const Small = await QuoteOk(Sales.Token, C, [{ ProductId: Exact, Quantity: 1 }]);
  expect(Money((await GetQuote(Sales.Token, Small)).Body.Data.Total)).toBe("50000.00");
  const Res = await Submit(Sales.Token, Small);
  expect(Created(Res.Status)).toBe(true);
  expect(Res.Body.Data.Status).toBe("Approved");
  const Big = await QuoteOk(Sales.Token, C, [{ ProductId: Over, Quantity: 1 }]);
  expect(Money((await GetQuote(Sales.Token, Big)).Body.Data.Total)).toBe("50000.01");
  expect(await SubmitOk(Sales.Token, Big)).toBe("PendingApproval");
  expect(await StatusOf(A.Token, Big)).toBe("PendingApproval");
  expect((await Submit(Sales.Token, Big)).Status).toBe(409);
  expect((await Submit(Sales.Token, Small)).Status).toBe(409);
  expect((await Revise(Sales.Token, Small, [{ ProductId: Exact, Quantity: 2 }])).Status).toBe(409);
  expect((await Revise(Sales.Token, Big, [{ ProductId: Exact, Quantity: 1 }])).Status).toBe(409);
  expect((await Approve(A.Token, Small)).Status).toBe(409);
});

test("r04: only an owner or admin other than the quote's author can approve", async () => {
  const { A, C, Over } = await Setup();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const OtherStaff = await NewUser(A.CompanyId, "Staff");
  const Admin = await NewUser(A.CompanyId, "Admin");
  const Admin2 = await NewUser(A.CompanyId, "Admin");
  const Draft = await QuoteOk(Sales.Token, C, [{ ProductId: Over, Quantity: 1 }]);
  expect((await Approve(Admin.Token, Draft)).Status).toBe(409);
  await SubmitOk(Sales.Token, Draft);
  expect((await Approve(Sales.Token, Draft)).Status).toBe(403);
  expect((await Approve(OtherStaff.Token, Draft)).Status).toBe(403);
  expect(await StatusOf(A.Token, Draft)).toBe("PendingApproval");
  const Ok = await Approve(Admin.Token, Draft);
  expect(Created(Ok.Status)).toBe(true);
  expect(Ok.Body.Data.Status).toBe("Approved");
  expect(Number(Ok.Body.Data.ApprovedBy)).toBe(Admin.UserId);
  expect((await Approve(A.Token, Draft)).Status).toBe(409);
  const Own = await QuoteOk(Admin.Token, C, [{ ProductId: Over, Quantity: 2 }]);
  await SubmitOk(Admin.Token, Own);
  expect((await Approve(Admin.Token, Own)).Status).toBe(403);
  expect(Number((await Approve(Admin2.Token, Own)).Body.Data.ApprovedBy)).toBe(Admin2.UserId);
});

test("r04: approving the same quote at the same moment approves it once", async () => {
  const { A, C, Over } = await Setup();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const Admin = await NewUser(A.CompanyId, "Admin");
  const B = await NewCompany();
  const Id = await QuoteOk(Sales.Token, C, [{ ProductId: Over, Quantity: 1 }]);
  await SubmitOk(Sales.Token, Id);
  expect((await Approve(B.Token, Id)).Status).toBe(404);
  expect((await Submit(B.Token, Id)).Status).toBe(404);
  expect((await Approve(A.Token, 99999999999)).Status).toBe(404);
  const Results = await Promise.all([Approve(A.Token, Id), Approve(Admin.Token, Id), Approve(A.Token, Id), Approve(Admin.Token, Id)]);
  const Wins = Results.filter((R) => Created(R.Status));
  expect(Wins.length).toBe(1);
  for (const R of Results.filter((R) => !Created(R.Status))) expect(R.Status).toBe(409);
  const Read = (await GetQuote(A.Token, Id)).Body.Data;
  expect(Read.Status).toBe("Approved");
  expect([A.UserId, Admin.UserId]).toContain(Number(Wins[0].Body.Data.ApprovedBy));
});
