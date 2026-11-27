import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, NewOrder, NewUser, OpenShift, Reset, Sql, TakeCash } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r05: the daily cash report splits cash by shift and keeps older cash payments", async () => {
  const Customer = await NewCustomer(A.CompanyId);
  for (const Amount of ["10.10", "20.20"]) {
    const OrderId = await NewOrder(A.CompanyId, Customer, Amount);
    await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method","CreatedAt") VALUES ($1,$2,$3,'Cash', now())`, [A.CompanyId, OrderId, Amount]);
  }
  const OldOrder = await NewOrder(A.CompanyId, Customer, "99.00");
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method","CreatedAt") VALUES ($1,$2,'99.00','Cash', now() - interval '3 days')`, [A.CompanyId, OldOrder]);
  const Cashier = await NewUser(A.CompanyId, "Staff");
  const ShiftId = (await OpenShift(Cashier.Token, "100.00")).Body.Data.Id;
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "40.00"), "40.00");
  await TakeCash(Cashier.Token, await NewOrder(A.CompanyId, Customer, "60.00"), "60.00", "Card");
  await Call("POST", `/Shifts/${ShiftId}/CashOut`, { Token: Cashier.Token, Body: { Amount: "5.00", Reason: "شاي" } });
  const B = await NewCompany();
  const BC = await NewCustomer(B.CompanyId);
  await Sql(`INSERT INTO "Payments" ("CompanyId","OrderId","Amount","Method") VALUES ($1,$2,'777.00','Cash')`, [B.CompanyId, await NewOrder(B.CompanyId, BC, "777.00")]);
  const Days = [...new Set([new Date().toISOString().slice(0, 10), new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date())])];
  const Seen = [];
  for (const Day of Days) {
    const Res = await Call("GET", `/Reports/Cash?Date=${Day}`, { Token: A.Token });
    expect(Res.Status).toBe(200);
    const D = Res.Body.Data;
    const Shift = (D.Shifts ?? []).find((S: any) => S.ShiftId === ShiftId);
    Seen.push(D);
    if (D.Unassigned === "30.30" && D.Shifts?.length === 1 && Shift?.UserId === Cashier.UserId && Shift?.CashIn === "40.00" && Shift?.CashOut === "5.00" && D.Total === "65.30") return;
  }
  expect(Seen).toEqual([{ Unassigned: "30.30", Shifts: [{ ShiftId, UserId: Cashier.UserId, CashIn: "40.00", CashOut: "5.00" }], Total: "65.30" }]);
});

test("r05: a malformed date is refused", async () => {
  expect((await Call("GET", "/Reports/Cash?Date=2026-13-01", { Token: A.Token })).Status).toBe(400);
});
