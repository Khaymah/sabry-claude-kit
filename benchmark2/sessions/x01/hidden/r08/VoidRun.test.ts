import { beforeEach, expect, test } from "bun:test";
import { AllPayslips, CancelLeave, Created, LeaveOk, MySlip, NewCompany, NewEmployee, PayslipPage, Pt, Reset, Run, RunOk, SetEmployee, SlipOf, VoidRun } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let E: Awaited<ReturnType<typeof NewEmployee>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  E = await NewEmployee(A.Token, "Karim");
  await SetEmployee(A.Token, E.UserId, "4800.00");
});

test("r08: a voided month disappears and can be paid again once with today's data", async () => {
  const First = await RunOk(A.Token, "2026-03");
  const Res = await VoidRun(A.Token, First.Id);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Status).toBe("Voided");
  expect((await PayslipPage(A.Token, "2026-03")).Status).toBe(404);
  expect((await MySlip(E.Token, "2026-03")).Status).toBe(404);
  expect((await VoidRun(A.Token, First.Id)).Status).toBe(409);
  await SetEmployee(A.Token, E.UserId, "6000.00");
  const Second = await RunOk(A.Token, "2026-03");
  expect(Second.Id).not.toBe(First.Id);
  expect(Pt(SlipOf(Second.Payslips, E.UserId).BaseSalary)).toBe(600000);
  expect((await Run(A.Token, "2026-03")).Status).toBe(409);
  const Listed = await AllPayslips(A.Token, "2026-03");
  expect(Listed.Items.length).toBe(1);
  expect(Pt(Listed.Res?.Body.Data.TotalNetPay)).toBe(600000);
  expect(Pt((await MySlip(E.Token, "2026-03")).Body.Data.NetPay)).toBe(600000);
});

test("r08: double clicks on void and on the re-run pay the month once", async () => {
  const First = await RunOk(A.Token, "2026-03");
  const Voids = await Promise.all([VoidRun(A.Token, First.Id), VoidRun(A.Token, First.Id)]);
  expect(Voids.filter((R) => R.Status === 200).length).toBe(1);
  expect(Voids.filter((R) => R.Status === 409).length).toBe(1);
  const Runs = await Promise.all([Run(A.Token, "2026-03"), Run(A.Token, "2026-03"), Run(A.Token, "2026-03")]);
  expect(Runs.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Runs.filter((R) => R.Status === 409).length).toBe(2);
  const Listed = await AllPayslips(A.Token, "2026-03");
  expect(Listed.Items.length).toBe(1);
});

test("r08: after a void the month's leave can be cancelled; only the owner voids, only own company", async () => {
  const Leave = await LeaveOk(A.Token, E.UserId, "Unpaid", "2026-03-22", "2026-03-23");
  const First = await RunOk(A.Token, "2026-03");
  expect(Pt(SlipOf(First.Payslips, E.UserId).UnpaidLeaveDeduction)).toBe(32000);
  expect((await CancelLeave(A.Token, Leave)).Status).toBe(409);
  const Admin = await NewEmployee(A.Token, "Admin One", "Admin");
  expect((await VoidRun(Admin.Token, First.Id)).Status).toBe(403);
  const B = await NewCompany();
  expect((await VoidRun(B.Token, First.Id)).Status).toBe(404);
  for (const Bad of ["99999999999", "2147483648", "abc"]) expect([400, 404]).toContain((await VoidRun(A.Token, Bad)).Status);
  expect((await PayslipPage(A.Token, "2026-03")).Status).toBe(200);
  expect((await VoidRun(A.Token, First.Id)).Status).toBe(200);
  expect((await CancelLeave(A.Token, Leave)).Status).toBe(200);
  const Second = await RunOk(A.Token, "2026-03");
  expect(Pt(SlipOf(Second.Payslips, E.UserId).UnpaidLeaveDeduction)).toBe(0);
  expect(Pt(SlipOf(Second.Payslips, E.UserId).NetPay)).toBe(480000);
});
