import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, Reset } from "../_Support";

beforeEach(async () => {
  await Reset();
});

test("r03: a customer's orders are listed newest first with paging", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  const Other = await NewCustomer(A.CompanyId);
  const Ids = [];
  for (let I = 0; I < 5; I++) Ids.push(await NewOrder(A.CompanyId, Customer, "10.00"));
  await NewOrder(A.CompanyId, Other, "99.00");
  const Res = await Call("GET", `/Customers/${Customer}/Orders?Page=1&PageSize=3`, { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Total).toBe(5);
  expect(Res.Body.Data.Items.map((O: any) => O.Id)).toEqual([Ids[4], Ids[3], Ids[2]]);
});

test("r03: another shop's customer history is not visible", async () => {
  const A = await NewCompany();
  const Customer = await NewCustomer(A.CompanyId);
  await NewOrder(A.CompanyId, Customer, "10.00");
  const B = await NewCompany();
  const Res = await Call("GET", `/Customers/${Customer}/Orders`, { Token: B.Token });
  expect(Res.Status).toBe(404);
});
