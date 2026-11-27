import { beforeEach, expect, test } from "bun:test";
import { AllPayslips, AttendanceOf, Day, MySlip, NewCompany, NewEmployee, Pt, Reset, RunOk, SetEmployee, SlipOf, Work } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

test("r07: overtime is double from 15 April by attendance day, one and a half before", async () => {
  const E = await NewEmployee(A.Token, "Day Shift");
  await SetEmployee(A.Token, E.UserId, "4800.00", "09:00", "17:00");
  await Work(E.Token, "2026-04-14T09:00:00+02:00", "2026-04-14T17:50:00+02:00");
  await Work(E.Token, "2026-04-15T09:00:00+02:00", "2026-04-15T17:50:00+02:00");
  await Work(E.Token, "2026-04-20T08:55:00+02:00", "2026-04-20T18:10:00+02:00");
  const N = await NewEmployee(A.Token, "Night Shift");
  await SetEmployee(A.Token, N.UserId, "7200.00", "22:00", "06:00");
  await Work(N.Token, "2026-04-14T22:00:00+02:00", "2026-04-15T06:50:00+02:00");
  await Work(N.Token, "2026-04-15T22:00:00+02:00", "2026-04-16T06:30:00+02:00");
  const Days = (await AttendanceOf(A.Token, E.UserId, "2026-04")).Items.map((I: any) => [Day(I.Date), Number(I.OvertimeMinutes)]);
  expect(Days).toEqual([["2026-04-14", 45], ["2026-04-15", 45], ["2026-04-20", 60]]);
  const April = await RunOk(A.Token, "2026-04");
  expect(Pt(SlipOf(April.Payslips, E.UserId).OvertimePay)).toBe(2250 + 3000 + 4000);
  expect(Pt(SlipOf(April.Payslips, E.UserId).NetPay)).toBe(480000 + 9250);
  expect(Pt(SlipOf(April.Payslips, N.UserId).OvertimePay)).toBe(3375 + 3000);
  expect(Pt((await MySlip(N.Token, "2026-04")).Body.Data.NetPay)).toBe(720000 + 6375);
});

test("r07: months before the change keep one and a half", async () => {
  const E = await NewEmployee(A.Token, "Before");
  await SetEmployee(A.Token, E.UserId, "4800.00", "09:00", "17:00");
  await Work(E.Token, "2026-03-16T09:10:00+02:00", "2026-03-16T17:50:00+02:00");
  await Work(E.Token, "2026-03-17T09:00:00+02:00", "2026-03-17T19:00:00+02:00");
  const March = await RunOk(A.Token, "2026-03");
  const Slip = SlipOf(March.Payslips, E.UserId);
  expect(Pt(Slip.OvertimePay)).toBe(2250 + 6000);
  expect(Pt(Slip.LateDeduction)).toBe(500);
  expect(Pt(Slip.NetPay)).toBe(480000 + 8250 - 500);
  const Listed = await AllPayslips(A.Token, "2026-03");
  expect(Pt(SlipOf(Listed.Items, E.UserId).OvertimePay)).toBe(8250);
});
