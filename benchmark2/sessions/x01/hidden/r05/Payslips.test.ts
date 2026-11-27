import { expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { AllPayslips, ListOf, MySlip, NewCompany, NewEmployee, PayslipPage, Pt, Reset, RunOk, SetEmployee, Work } from "../_Support";

test("r05: the payslip list is sorted by name, paged, totalled and keeps what was paid", async () => {
  await Reset();
  const A = await NewCompany();
  const Z = await NewEmployee(A.Token, "Zeinab");
  const Ad = await NewEmployee(A.Token, "Adel");
  const M = await NewEmployee(A.Token, "Mai");
  await SetEmployee(A.Token, Z.UserId, "6000.00");
  await SetEmployee(A.Token, Ad.UserId, "4800.00");
  await SetEmployee(A.Token, M.UserId, "7200.00");
  await Work(Ad.Token, "2026-03-02T09:20:00+02:00", "2026-03-02T18:00:00+02:00");
  await RunOk(A.Token, "2026-03");
  await SetEmployee(A.Token, Ad.UserId, "9999.00");
  const First = await PayslipPage(A.Token, "2026-03", 1, 2);
  expect(First.Status).toBe(200);
  expect(First.Body.Data.Total).toBe(3);
  expect(Pt(First.Body.Data.TotalNetPay)).toBe(600000 + 482000 + 720000);
  const Items = ListOf(First.Body.Data);
  expect(Items.map((I: any) => I.Name)).toEqual(["Adel", "Mai"]);
  const AdelRow = Items[0];
  expect(Number(AdelRow.UserId)).toBe(Ad.UserId);
  expect([AdelRow.BaseSalary, AdelRow.OvertimePay, AdelRow.LateDeduction, AdelRow.UnpaidLeaveDeduction, AdelRow.NetPay].map(Pt)).toEqual([480000, 3000, 1000, 0, 482000]);
  const Second = ListOf((await PayslipPage(A.Token, "2026-03", 2, 2)).Body.Data);
  expect(Second.map((I: any) => I.Name)).toEqual(["Zeinab"]);
  const Mine = await MySlip(M.Token, "2026-03");
  expect(Mine.Status).toBe(200);
  expect(Pt(Mine.Body.Data.NetPay)).toBe(720000);
  expect(Pt(Mine.Body.Data.BaseSalary)).toBe(720000);
  expect(Pt((await MySlip(Ad.Token, "2026-03")).Body.Data.BaseSalary)).toBe(480000);
  expect((await PayslipPage(M.Token, "2026-03")).Status).toBe(403);
  expect((await PayslipPage(A.Token, "2026-04")).Status).toBe(404);
  expect((await MySlip(M.Token, "2026-04")).Status).toBe(404);
  const B = await NewCompany();
  expect((await PayslipPage(B.Token, "2026-03")).Status).toBe(404);
  expect((await MySlip(B.Token, "2026-03")).Status).toBe(404);
});

test("r05: a page of payslips stays within a small query budget at volume", async () => {
  await Reset();
  const A = await NewCompany();
  const Ids: number[] = [];
  for (let I = 0; I < 120; I++) {
    const E = await NewEmployee(A.Token, `Staff ${String(I).padStart(3, "0")}`);
    await SetEmployee(A.Token, E.UserId, "4800.00");
    if (I % 3 === 0) await Work(E.Token, "2026-03-02T09:20:00+02:00", "2026-03-02T17:50:00+02:00");
    Ids.push(E.UserId);
  }
  await RunOk(A.Token, "2026-03");
  QueryStats.Reset();
  const Res = await PayslipPage(A.Token, "2026-03", 1, 100);
  const Queries = QueryStats.Count;
  expect(Res.Status).toBe(200);
  expect(ListOf(Res.Body.Data).length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(8);
  const All = await AllPayslips(A.Token, "2026-03");
  expect(All.Items.length).toBe(120);
  expect(new Set(All.Items.map((I: any) => Number(I.UserId))).size).toBe(120);
  expect(Pt(SlipNet(All.Items, Ids[3]))).toBe(480000 + 2250 - 1000);
  expect(Pt(SlipNet(All.Items, Ids[4]))).toBe(480000);
  expect(Pt(Res.Body.Data.TotalNetPay)).toBe(120 * 480000 + 40 * 1250);
}, 120000);

function SlipNet(Items: any[], UserId: number) {
  return Items.find((I: any) => Number(I.UserId) === UserId)?.NetPay;
}
