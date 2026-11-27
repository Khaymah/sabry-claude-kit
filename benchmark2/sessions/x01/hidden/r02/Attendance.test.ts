import { beforeEach, expect, test } from "bun:test";
import { At, AttendanceOf, CheckIn, CheckOut, Created, Day, NewCompany, NewEmployee, Reset, SetEmployee, Work } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

const Summary = (Items: any[]) => Items.map((I: any) => [Day(I.Date), Number(I.LateMinutes), Number(I.OvertimeMinutes)]);

test("r02: lateness rounds up and overtime rounds down to a quarter hour", async () => {
  const E = await NewEmployee(A.Token);
  await SetEmployee(A.Token, E.UserId, "4800.00", "09:00", "17:00");
  const First = await Work(E.Token, "2026-03-02T09:01:00+02:00", "2026-03-02T17:14:00+02:00");
  expect(Number(First.In.Body.Data.LateMinutes)).toBe(15);
  expect(Number(First.Out.Body.Data.OvertimeMinutes)).toBe(0);
  const Second = await Work(E.Token, "2026-03-03T09:16:00+02:00", "2026-03-03T17:50:00+02:00");
  expect(Number(Second.In.Body.Data.LateMinutes)).toBe(30);
  expect(Number(Second.Out.Body.Data.OvertimeMinutes)).toBe(45);
  await Work(E.Token, "2026-03-04T08:45:00+02:00", "2026-03-04T17:15:00+02:00");
  await Work(E.Token, "2026-03-05T09:15:00+02:00", "2026-03-05T16:30:00+02:00");
  const List = await AttendanceOf(A.Token, E.UserId, "2026-03");
  expect(List.Status).toBe(200);
  expect(Summary(List.Items)).toEqual([
    ["2026-03-02", 15, 0],
    ["2026-03-03", 30, 45],
    ["2026-03-04", 0, 15],
    ["2026-03-05", 15, 0],
  ]);
  expect((await AttendanceOf(A.Token, E.UserId, "2026-04")).Items.length).toBe(0);
});

test("r02: Cairo days and a night shift that crosses midnight", async () => {
  const Night = await NewEmployee(A.Token);
  await SetEmployee(A.Token, Night.UserId, "7200.00", "22:00", "06:00");
  const Shift = await Work(Night.Token, "2026-03-04T22:20:00+02:00", "2026-03-05T06:50:00+02:00");
  expect(Day(Shift.Out.Body.Data.Date)).toBe("2026-03-04");
  expect(Number(Shift.Out.Body.Data.OvertimeMinutes)).toBe(45);
  await Work(Night.Token, "2026-03-05T21:55:00+02:00", "2026-03-06T06:05:00+02:00");
  expect(Summary((await AttendanceOf(A.Token, Night.UserId, "2026-03")).Items)).toEqual([
    ["2026-03-04", 30, 45],
    ["2026-03-05", 0, 0],
  ]);
  const Dawn = await NewEmployee(A.Token);
  await SetEmployee(A.Token, Dawn.UserId, "6000.00", "01:00", "09:00");
  const Early = await Work(Dawn.Token, "2026-03-05T00:55:00+02:00", "2026-03-05T09:40:00+02:00");
  expect(Day(Early.In.Body.Data.Date)).toBe("2026-03-05");
  expect(Number(Early.In.Body.Data.LateMinutes)).toBe(0);
  expect((await CheckIn(Dawn.Token, "2026-03-05T23:30:00+02:00")).Status).toBe(409);
  expect(Summary((await AttendanceOf(A.Token, Dawn.UserId, "2026-03")).Items)).toEqual([["2026-03-05", 0, 30]]);
});

test("r02: a double tap on check-in or check-out counts once", async () => {
  const E = await NewEmployee(A.Token);
  await SetEmployee(A.Token, E.UserId, "4800.00");
  const Other = await NewEmployee(A.Token);
  await SetEmployee(A.Token, Other.UserId, "4800.00");
  At("2026-03-09T09:20:00+02:00");
  const Ins = await Promise.all([CheckIn(E.Token), CheckIn(E.Token), CheckIn(E.Token)]);
  expect(Ins.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Ins.filter((R) => R.Status === 409).length).toBe(2);
  At("2026-03-09T17:40:00+02:00");
  const Outs = await Promise.all([CheckOut(E.Token), CheckOut(E.Token)]);
  expect(Outs.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Outs.filter((R) => R.Status === 409).length).toBe(1);
  expect((await CheckOut(Other.Token)).Status).toBe(409);
  expect(Summary((await AttendanceOf(A.Token, E.UserId, "2026-03")).Items)).toEqual([["2026-03-09", 30, 30]]);
});

test("r02: another company's attendance and bad queries are refused", async () => {
  const B = await NewCompany();
  const BE = await NewEmployee(B.Token);
  await SetEmployee(B.Token, BE.UserId, "4800.00");
  await Work(BE.Token, "2026-03-02T09:00:00+02:00", "2026-03-02T17:00:00+02:00");
  expect((await AttendanceOf(A.Token, BE.UserId, "2026-03")).Status).toBe(404);
  expect((await AttendanceOf(B.Token, BE.UserId, "2026-03")).Items.length).toBe(1);
  for (const Id of ["99999999999", "abc", "0"]) expect([400, 404]).toContain((await AttendanceOf(A.Token, Id, "2026-03")).Status);
  for (const Month of ["2026-13", "March", "2026-3"]) expect((await AttendanceOf(B.Token, BE.UserId, Month)).Status).toBe(400);
});
