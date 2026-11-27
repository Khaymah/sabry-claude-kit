import { beforeEach, expect, test } from "bun:test";
import { Created, LeaveOk, NewCompany, NewEmployee, Pt, Reset, Run, RunOk, SetEmployee, SlipOf, Work } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Day: Awaited<ReturnType<typeof NewEmployee>>;
let Night: Awaited<ReturnType<typeof NewEmployee>>;
let Dawn: Awaited<ReturnType<typeof NewEmployee>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  Day = await NewEmployee(A.Token, "Ahmed");
  Night = await NewEmployee(A.Token, "Basma");
  Dawn = await NewEmployee(A.Token, "Hany");
  await SetEmployee(A.Token, Day.UserId, "4800.00", "09:00", "17:00");
  await SetEmployee(A.Token, Night.UserId, "7200.00", "22:00", "06:00");
  await SetEmployee(A.Token, Dawn.UserId, "6000.00", "01:00", "09:00");
  await Work(Day.Token, "2026-03-02T09:20:00+02:00", "2026-03-02T17:50:00+02:00");
  await Work(Day.Token, "2026-03-03T09:01:00+02:00", "2026-03-03T17:00:00+02:00");
  await LeaveOk(A.Token, Day.UserId, "Annual", "2026-03-10", "2026-03-11");
  await LeaveOk(A.Token, Day.UserId, "Unpaid", "2026-03-30", "2026-04-02");
  await Work(Night.Token, "2026-03-31T21:50:00+02:00", "2026-04-01T07:00:00+02:00");
  await Work(Night.Token, "2026-04-01T22:30:00+02:00", "2026-04-02T06:00:00+02:00");
  await Work(Dawn.Token, "2026-04-01T01:10:00+02:00", "2026-04-01T09:00:00+02:00");
});

const Money = (Slip: any) => [Slip.BaseSalary, Slip.OvertimePay, Slip.LateDeduction, Slip.UnpaidLeaveDeduction, Slip.NetPay].map(Pt);

test("r04: a month's payslips from attendance, overtime, lateness and unpaid leave", async () => {
  const March = await RunOk(A.Token, "2026-03");
  expect(March.Res.Body.Data.Month).toBe("2026-03");
  expect(March.Payslips.length).toBe(3);
  expect(SlipOf(March.Payslips, A.UserId)).toBeUndefined();
  expect(Money(SlipOf(March.Payslips, Day.UserId))).toEqual([480000, 2250, 1500, 32000, 448750]);
  expect(Money(SlipOf(March.Payslips, Night.UserId))).toEqual([720000, 4500, 0, 0, 724500]);
  expect(Money(SlipOf(March.Payslips, Dawn.UserId))).toEqual([600000, 0, 0, 0, 600000]);
  const April = await RunOk(A.Token, "2026-04");
  expect(Money(SlipOf(April.Payslips, Day.UserId))).toEqual([480000, 0, 0, 32000, 448000]);
  expect(Money(SlipOf(April.Payslips, Night.UserId))).toEqual([720000, 0, 1500, 0, 718500]);
  expect(Money(SlipOf(April.Payslips, Dawn.UserId))).toEqual([600000, 0, 625, 0, 599375]);
});

test("r04: a month is never paid twice, even on a double click", async () => {
  const Results = await Promise.all([Run(A.Token, "2026-03"), Run(A.Token, "2026-03"), Run(A.Token, "2026-03")]);
  expect(Results.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Results.filter((R) => R.Status === 409).length).toBe(2);
  expect((await Run(A.Token, "2026-03")).Status).toBe(409);
  const B = await NewCompany();
  const BE = await NewEmployee(B.Token, "Other");
  await SetEmployee(B.Token, BE.UserId, "3000.00");
  const BRun = await RunOk(B.Token, "2026-03");
  expect(BRun.Payslips.length).toBe(1);
  expect(SlipOf(BRun.Payslips, Day.UserId)).toBeUndefined();
  expect(Pt(SlipOf(BRun.Payslips, BE.UserId).NetPay)).toBe(300000);
});

test("r04: bad months and staff are refused and nothing is paid", async () => {
  for (const Month of ["2026-13", "March", "2026-3", ""]) expect((await Run(A.Token, Month)).Status).toBe(400);
  expect((await Run(Day.Token, "2026-03")).Status).toBe(403);
  const March = await RunOk(A.Token, "2026-03");
  expect(March.Payslips.length).toBe(3);
});
