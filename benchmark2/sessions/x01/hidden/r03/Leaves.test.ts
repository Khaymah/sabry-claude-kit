import { beforeEach, expect, test } from "bun:test";
import { Balance, Created, Leave, NewCompany, NewEmployee, Reset, SetEmployee } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let E: Awaited<ReturnType<typeof NewEmployee>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  E = await NewEmployee(A.Token);
  await SetEmployee(A.Token, E.UserId, "4800.00");
});

test("r03: leave days skip Fridays, annual uses the 21-day balance, overlaps are refused", async () => {
  const Start = await Balance(A.Token, E.UserId);
  expect(Start.Status).toBe(200);
  expect([Start.Entitled, Start.Used, Start.Remaining]).toEqual([21, 0, 21]);
  const First = await Leave(A.Token, E.UserId, "Annual", "2026-03-08", "2026-03-14");
  expect(Created(First.Status)).toBe(true);
  expect(Number(First.Body.Data.Days)).toBe(6);
  expect(First.Body.Data.Id).toBeDefined();
  expect((await Leave(A.Token, E.UserId, "Unpaid", "2026-03-14", "2026-03-16")).Status).toBe(409);
  const Unpaid = await Leave(A.Token, E.UserId, "Unpaid", "2026-03-15", "2026-03-16");
  expect(Created(Unpaid.Status)).toBe(true);
  expect(Number(Unpaid.Body.Data.Days)).toBe(2);
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(15);
  expect((await Leave(A.Token, E.UserId, "Annual", "2026-04-05", "2026-04-22")).Status).toBe(409);
  const Rest = await Leave(A.Token, E.UserId, "Annual", "2026-04-05", "2026-04-21");
  expect(Created(Rest.Status)).toBe(true);
  expect(Number(Rest.Body.Data.Days)).toBe(15);
  expect((await Leave(A.Token, E.UserId, "Annual", "2026-04-22", "2026-04-22")).Status).toBe(409);
  const End = await Balance(A.Token, E.UserId);
  expect([End.Entitled, End.Used, End.Remaining]).toEqual([21, 21, 0]);
  expect((await Leave(E.Token, E.UserId, "Unpaid", "2026-05-03", "2026-05-03")).Status).toBe(403);
});

test("r03: parallel leave requests can never push the balance below zero", async () => {
  const Same = await Promise.all([
    Leave(A.Token, E.UserId, "Annual", "2026-03-01", "2026-03-12"),
    Leave(A.Token, E.UserId, "Annual", "2026-03-01", "2026-03-12"),
    Leave(A.Token, E.UserId, "Annual", "2026-03-01", "2026-03-12"),
  ]);
  expect(Same.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Same.filter((R) => R.Status === 409).length).toBe(2);
  expect((await Balance(A.Token, E.UserId)).Remaining).toBe(10);
  const Two = await Promise.all([
    Leave(A.Token, E.UserId, "Annual", "2026-04-05", "2026-04-11"),
    Leave(A.Token, E.UserId, "Annual", "2026-05-03", "2026-05-09"),
  ]);
  expect(Two.filter((R) => Created(R.Status)).length).toBe(1);
  expect(Two.filter((R) => R.Status === 409).length).toBe(1);
  const After = await Balance(A.Token, E.UserId);
  expect(After.Remaining).toBe(4);
  expect(After.Used).toBe(17);
});

test("r03: bad dates, types, ids and other companies are refused", async () => {
  const Bad = [
    ["Annual", "2026-03-10", "2026-03-08"],
    ["Annual", "2026-02-30", "2026-03-02"],
    ["Annual", "2026-03-08", "tomorrow"],
    ["Sick", "2026-03-08", "2026-03-09"],
  ];
  for (const [Type, From, To] of Bad) expect((await Leave(A.Token, E.UserId, Type, From, To)).Status).toBe(400);
  expect([400, 409]).toContain((await Leave(A.Token, E.UserId, "Annual", "2026-03-06", "2026-03-06")).Status);
  for (const Id of ["99999999999", "2147483648", "abc", "0"]) {
    expect([400, 404]).toContain((await Leave(A.Token, Id, "Annual", "2026-03-08", "2026-03-08")).Status);
    expect([400, 404]).toContain((await Balance(A.Token, Id)).Status);
  }
  const B = await NewCompany();
  expect((await Leave(B.Token, E.UserId, "Annual", "2026-03-08", "2026-03-09")).Status).toBe(404);
  expect((await Balance(B.Token, E.UserId)).Status).toBe(404);
  const Now = await Balance(A.Token, E.UserId);
  expect([Now.Used, Now.Remaining]).toEqual([0, 21]);
});
