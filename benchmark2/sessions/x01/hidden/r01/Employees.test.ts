import { expect, test } from "bun:test";
import { Call, Created, Employees, MigrateRest, NewCompany, NewEmployee, NewUser, Pt, PutEmployee, Reset } from "../_Support";

const Find = (List: any[], UserId: number) => List.find((E: any) => Number(E.UserId) === UserId);

test("r01: the owner sets salary and a night shift, listed for this company only", async () => {
  await Reset();
  const A = await NewCompany();
  const B = await NewCompany();
  const E = await NewEmployee(A.Token, "Mona Adel");
  const Res = await PutEmployee(A.Token, E.UserId, { MonthlySalary: "4800.50", ShiftStart: "22:00", ShiftEnd: "06:00" });
  expect(Created(Res.Status)).toBe(true);
  const List = await Employees(A.Token);
  const Row = Find(List, E.UserId);
  expect(Row.Name).toBe("Mona Adel");
  expect(Pt(Row.MonthlySalary)).toBe(480050);
  expect(Row.ShiftStart).toBe("22:00");
  expect(Row.ShiftEnd).toBe("06:00");
  const Owner = Find(List, A.UserId);
  expect(Pt(Owner.MonthlySalary)).toBe(0);
  expect(Owner.ShiftStart).toBe("09:00");
  expect(Owner.ShiftEnd).toBe("17:00");
  expect(Find(await Employees(B.Token), E.UserId)).toBeUndefined();
  expect((await PutEmployee(B.Token, E.UserId, { MonthlySalary: "1.00", ShiftStart: "09:00", ShiftEnd: "17:00" })).Status).toBe(404);
  expect((await PutEmployee(E.Token, E.UserId, { MonthlySalary: "99999.00", ShiftStart: "09:00", ShiftEnd: "17:00" })).Status).toBe(403);
  expect(Pt(Find(await Employees(A.Token), E.UserId).MonthlySalary)).toBe(480050);
});

test("r01: users that existed before the feature are employees with no salary yet", async () => {
  await Reset("0001_Init");
  const A = await NewCompany();
  const Old = await NewUser(A.CompanyId, "Staff", "Old Timer");
  const B = await NewCompany();
  await MigrateRest();
  const List = await Employees(A.Token);
  const Row = Find(List, Old.UserId);
  expect(Row).toBeDefined();
  expect(Row.Name).toBe("Old Timer");
  expect(Pt(Row.MonthlySalary)).toBe(0);
  expect(Row.ShiftStart).toBe("09:00");
  expect(Row.ShiftEnd).toBe("17:00");
  expect(Find(List, A.UserId)).toBeDefined();
  expect(Find(List, B.UserId)).toBeUndefined();
  const Res = await PutEmployee(A.Token, Old.UserId, { MonthlySalary: "3000.00", ShiftStart: "08:30", ShiftEnd: "16:30" });
  expect(Created(Res.Status)).toBe(true);
  const After = Find(await Employees(A.Token), Old.UserId);
  expect(Pt(After.MonthlySalary)).toBe(300000);
  expect(After.ShiftStart).toBe("08:30");
});

test("r01: bad salaries, shifts and ids are refused without a server error", async () => {
  await Reset();
  const A = await NewCompany();
  const E = await NewEmployee(A.Token);
  const Good = { MonthlySalary: "5000.00", ShiftStart: "09:00", ShiftEnd: "17:00" };
  const Bad = [
    { ...Good, MonthlySalary: "-1.00" },
    { ...Good, MonthlySalary: "12.345" },
    { ...Good, MonthlySalary: "abc" },
    { ...Good, MonthlySalary: 1e15 },
    { ...Good, MonthlySalary: "999999999999.00" },
    { ...Good, ShiftStart: "25:00" },
    { ...Good, ShiftEnd: "17:75" },
    { ...Good, ShiftStart: "nine" },
  ];
  for (const Body of Bad) expect((await PutEmployee(A.Token, E.UserId, Body)).Status).toBe(400);
  for (const Id of ["99999999999", "0", "-3", "abc", "2147483648"]) {
    expect([400, 404]).toContain((await PutEmployee(A.Token, Id, Good)).Status);
  }
  const Row = Find(await Employees(A.Token), E.UserId);
  expect(Pt(Row.MonthlySalary)).toBe(0);
  expect((await Call("GET", "/Employees")).Status).toBe(401);
});
