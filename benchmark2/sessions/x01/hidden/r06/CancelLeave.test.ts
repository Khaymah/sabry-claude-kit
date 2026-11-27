import { beforeEach, expect, test } from "bun:test";
import { AllPayslips, Balance, CancelLeave, Created, Leave, LeaveOk, NewCompany, NewEmployee, Pt, Reset, RunOk, SetEmployee, SlipOf } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let E: Awaited<ReturnType<typeof NewEmployee>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  E = await NewEmployee(A.Token, "Salma");
  await SetEmployee(A.Token, E.UserId, "4800.00");
});

test("r06: cancelling gives the days back once and frees the dates", async () => {
  const First = await LeaveOk(A.Token, E.UserId, "Annual", "2026-03-08", "2026-03-14");
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(15);
  const Res = await CancelLeave(A.Token, First);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Status).toBe("Cancelled");
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(21);
  const Second = await LeaveOk(A.Token, E.UserId, "Annual", "2026-04-05", "2026-04-09");
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(16);
  const Clicks = await Promise.all([CancelLeave(A.Token, Second), CancelLeave(A.Token, Second), CancelLeave(A.Token, Second)]);
  expect(Clicks.filter((R) => R.Status === 200).length).toBeGreaterThanOrEqual(1);
  for (const R of Clicks) expect([200, 409]).toContain(R.Status);
  const After = await Balance(A.Token, E.UserId);
  expect([After.Used, After.Remaining]).toEqual([0, 21]);
  const Again = await Leave(A.Token, E.UserId, "Annual", "2026-03-08", "2026-03-14");
  expect(Created(Again.Status)).toBe(true);
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(15);
});

test("r06: payroll ignores a cancelled unpaid leave, and a paid month's leave cannot be cancelled", async () => {
  const MarchLeave = await LeaveOk(A.Token, E.UserId, "Unpaid", "2026-03-22", "2026-03-23");
  const Spanning = await LeaveOk(A.Token, E.UserId, "Annual", "2026-03-30", "2026-04-01");
  const AprilLeave = await LeaveOk(A.Token, E.UserId, "Unpaid", "2026-04-05", "2026-04-06");
  const March = await RunOk(A.Token, "2026-03");
  expect(Pt(SlipOf(March.Payslips, E.UserId).UnpaidLeaveDeduction)).toBe(32000);
  expect((await CancelLeave(A.Token, MarchLeave)).Status).toBe(409);
  expect((await CancelLeave(A.Token, Spanning)).Status).toBe(409);
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(18);
  expect((await CancelLeave(A.Token, AprilLeave)).Status).toBe(200);
  const Listed = await AllPayslips(A.Token, "2026-03");
  expect(Pt(SlipOf(Listed.Items, E.UserId).NetPay)).toBe(448000);
  const April = await RunOk(A.Token, "2026-04");
  const Slip = SlipOf(April.Payslips, E.UserId);
  expect(Pt(Slip.UnpaidLeaveDeduction)).toBe(0);
  expect(Pt(Slip.NetPay)).toBe(480000);
});

test("r06: another company's leave, staff and bad ids are refused", async () => {
  const Id = await LeaveOk(A.Token, E.UserId, "Annual", "2026-03-08", "2026-03-09");
  const B = await NewCompany();
  expect((await CancelLeave(B.Token, Id)).Status).toBe(404);
  expect((await CancelLeave(E.Token, Id)).Status).toBe(403);
  for (const Bad of ["99999999999", "2147483648", "abc", "0"]) expect([400, 404]).toContain((await CancelLeave(A.Token, Bad)).Status);
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(19);
});
