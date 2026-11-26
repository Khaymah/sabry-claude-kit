import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewUser, OpenShift, Reset, TakeCash } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Cashier: Awaited<ReturnType<typeof NewUser>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Cashier = await NewUser(A.CompanyId, "Staff");
});

test("r04: a manager sees the shop's shifts and can close a forgotten one", async () => {
  const Id = (await OpenShift(Cashier.Token, "200.00")).Body.Data.Id;
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, await NewCustomer(A.CompanyId), "40.00"), "40.00");
  const List = await Call("GET", `/Shifts?UserId=${Cashier.UserId}`, { Token: A.Token });
  expect(List.Status).toBe(200);
  expect(List.Body.Data.Items.map((S: any) => S.Id)).toEqual([Id]);
  const Close = await Call("POST", `/Shifts/${Id}/ForceClose`, { Token: A.Token, Body: { CountedCash: "240.00" } });
  expect(Close.Status).toBe(200);
  expect(Close.Body.Data).toMatchObject({ ExpectedCash: "240.00", Difference: "0.00" });
  expect((await OpenShift(Cashier.Token)).Status).toBe(201);
});

test("r04: staff and other shops cannot manage shifts", async () => {
  const Id = (await OpenShift(Cashier.Token)).Body.Data.Id;
  const Staff = await NewUser(A.CompanyId, "Staff");
  expect((await Call("GET", "/Shifts", { Token: Staff.Token })).Status).toBe(403);
  expect((await Call("POST", `/Shifts/${Id}/ForceClose`, { Token: Staff.Token, Body: { CountedCash: "0.00" } })).Status).toBe(403);
  const B = await NewCompany();
  expect((await Call("POST", `/Shifts/${Id}/ForceClose`, { Token: B.Token, Body: { CountedCash: "0.00" } })).Status).toBe(404);
  const Others = await Call("GET", "/Shifts", { Token: B.Token });
  expect(Others.Body.Data.Items).toEqual([]);
});
