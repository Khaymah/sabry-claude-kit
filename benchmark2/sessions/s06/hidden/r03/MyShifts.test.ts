import { beforeEach, expect, test } from "bun:test";
import { Call, CloseShift, NewCompany, NewUser, OpenShift, Reset } from "../_Support";

beforeEach(async () => {
  await Reset();
});

test("r03: a cashier sees only their own shifts, newest first", async () => {
  const A = await NewCompany();
  const Me = await NewUser(A.CompanyId, "Staff");
  const Other = await NewUser(A.CompanyId, "Staff");
  const Ids = [];
  for (let I = 0; I < 3; I++) {
    const Id = (await OpenShift(Me.Token, "10.00")).Body.Data.Id;
    await CloseShift(Me.Token, Id, "10.00");
    Ids.push(Id);
  }
  await OpenShift(Other.Token);
  const Res = await Call("GET", "/Shifts/Mine?Page=1&PageSize=2", { Token: Me.Token });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Total).toBe(3);
  expect(Res.Body.Data.Items.map((S: any) => S.Id)).toEqual([Ids[2], Ids[1]]);
  expect(Res.Body.Data.Items[0].ClosedAt).toBeTruthy();
});
