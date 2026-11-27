import { expect, test } from "bun:test";
import { Approve, Call, ConvertOk, Created, ListOf, MigrateRest, Money, NewCompany, NewCustomer, NewProduct, NewUser, QuoteOk, Reset, Sql, StatusOf, StockOf, SubmitOk } from "../_Support";

async function Groups(Token: string) {
  const Res = await Call("GET", "/CustomerGroups", { Token });
  return { Status: Res.Status, Items: ListOf(Res.Body?.Data) };
}

test("r07: every company gets its own default group holding today's customers at 50,000", async () => {
  await Reset("0001_Init");
  const A = await NewCompany();
  const B = await NewCompany();
  const [Old] = await Sql<{ Id: number }>(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,'عميل قديم') RETURNING "Id"`, [A.CompanyId]);
  await Sql(`INSERT INTO "Customers" ("CompanyId","Name") VALUES ($1,'عميل قديم ب')`, [B.CompanyId]);
  await MigrateRest();
  const AG = await Groups(A.Token);
  expect(AG.Status).toBe(200);
  const ADefault = AG.Items.filter((G: any) => G.Name === "عادي");
  expect(ADefault.length).toBe(1);
  expect(Money(ADefault[0].ApprovalThreshold)).toBe("50000.00");
  const BDefault = (await Groups(B.Token)).Items.filter((G: any) => G.Name === "عادي");
  expect(BDefault.length).toBe(1);
  expect(BDefault[0].Id).not.toBe(ADefault[0].Id);
  const P = await NewProduct(A.CompanyId, { Price: "45000.00" });
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, Old.Id, [{ ProductId: P, Quantity: 1 }]))).toBe("PendingApproval");
  const Fresh = await NewCustomer(A.Token);
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, Fresh, [{ ProductId: P, Quantity: 1 }]))).toBe("PendingApproval");
  const Small = await NewProduct(A.CompanyId, { Price: "40000.00" });
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, Old.Id, [{ ProductId: Small, Quantity: 1 }]))).toBe("Approved");
  const Vip = await Call("POST", "/CustomerGroups", { Token: A.Token, Body: { Name: "كبار العملاء", ApprovalThreshold: "200000.00" } });
  expect(Created(Vip.Status)).toBe(true);
  expect(Money(Vip.Body.Data.ApprovalThreshold)).toBe("200000.00");
  expect((await Call("PATCH", `/Customers/${Old.Id}`, { Token: A.Token, Body: { GroupId: Vip.Body.Data.Id } })).Status).toBe(200);
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, Old.Id, [{ ProductId: P, Quantity: 3 }]))).toBe("Approved");
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, Old.Id, [{ ProductId: P, Quantity: 4 }]))).toBe("PendingApproval");
  expect((await Groups(B.Token)).Items.some((G: any) => G.Id === Vip.Body.Data.Id)).toBe(false);
});

test("r07: changing a group's threshold leaves quotes that were already decided alone", async () => {
  await Reset();
  const A = await NewCompany();
  const Sales = await NewUser(A.CompanyId, "Staff");
  const C = await NewCustomer(A.Token);
  const P = await NewProduct(A.CompanyId, { Price: "10000.00", Stock: 50 });
  const G = await Call("POST", "/CustomerGroups", { Token: A.Token, Body: { Name: "جملة", ApprovalThreshold: 30000 } });
  expect(Created(G.Status)).toBe(true);
  const GroupId = G.Body.Data.Id;
  expect((await Call("PATCH", `/Customers/${C}`, { Token: A.Token, Body: { GroupId } })).Status).toBe(200);
  const Auto = await QuoteOk(Sales.Token, C, [{ ProductId: P, Quantity: 2 }]);
  expect(await SubmitOk(Sales.Token, Auto)).toBe("Approved");
  const Waiting = await QuoteOk(Sales.Token, C, [{ ProductId: P, Quantity: 3 }]);
  expect(await SubmitOk(Sales.Token, Waiting)).toBe("PendingApproval");
  const Signed = await QuoteOk(Sales.Token, C, [{ ProductId: P, Quantity: 4 }]);
  expect(await SubmitOk(Sales.Token, Signed)).toBe("PendingApproval");
  expect(Created((await Approve(A.Token, Signed)).Status)).toBe(true);
  const Down = await Call("PATCH", `/CustomerGroups/${GroupId}`, { Token: A.Token, Body: { ApprovalThreshold: "5000.00" } });
  expect(Down.Status).toBe(200);
  expect(Money(Down.Body.Data.ApprovalThreshold)).toBe("5000.00");
  expect(await StatusOf(A.Token, Auto)).toBe("Approved");
  expect(await StatusOf(A.Token, Signed)).toBe("Approved");
  expect(await StatusOf(A.Token, Waiting)).toBe("PendingApproval");
  expect(await SubmitOk(Sales.Token, await QuoteOk(Sales.Token, C, [{ ProductId: P, Quantity: 1 }]))).toBe("PendingApproval");
  await ConvertOk(Sales.Token, Auto);
  await ConvertOk(Sales.Token, Signed);
  expect([await StockOf(A.Token, P)]).toEqual([44]);
});

test("r07: bad groups are refused and groups never cross companies", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const C = await NewCustomer(A.Token);
  for (const Body of [{ Name: "", ApprovalThreshold: "100.00" }, { Name: "x", ApprovalThreshold: -1 }, { Name: "x", ApprovalThreshold: "10.555" }, { Name: "x", ApprovalThreshold: 1e13 }, { Name: "x" }]) {
    expect((await Call("POST", "/CustomerGroups", { Token: A.Token, Body })).Status).toBe(400);
  }
  const BG = await Call("POST", "/CustomerGroups", { Token: B.Token, Body: { Name: "مجموعة المنافس", ApprovalThreshold: "1.00" } });
  expect(Created(BG.Status)).toBe(true);
  expect([400, 404]).toContain((await Call("PATCH", `/Customers/${C}`, { Token: A.Token, Body: { GroupId: BG.Body.Data.Id } })).Status);
  expect([400, 404]).toContain((await Call("PATCH", `/Customers/${C}`, { Token: A.Token, Body: { GroupId: 1e12 } })).Status);
  expect((await Call("PATCH", `/CustomerGroups/${BG.Body.Data.Id}`, { Token: A.Token, Body: { ApprovalThreshold: "999.00" } })).Status).toBe(404);
  expect((await Call("PATCH", `/CustomerGroups/99999999999`, { Token: A.Token, Body: { ApprovalThreshold: "999.00" } })).Status).toBe(404);
  const List = await Call("GET", "/CustomerGroups", { Token: A.Token });
  expect(List.Status).toBe(200);
  expect(List.Text).not.toContain("مجموعة المنافس");
  const P = await NewProduct(A.CompanyId, { Price: "100.00" });
  expect(await SubmitOk(A.Token, await QuoteOk(A.Token, C, [{ ProductId: P, Quantity: 1 }]))).toBe("Approved");
  const BList = ListOf((await Call("GET", "/CustomerGroups", { Token: B.Token })).Body.Data);
  expect(Money(BList.find((G: any) => G.Id === BG.Body.Data.Id).ApprovalThreshold)).toBe("1.00");
});
