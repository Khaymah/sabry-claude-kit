import { beforeEach, expect, test } from "bun:test";
import { Call, Huge, List, MainBranch, NewBranch, NewExpense, NewMember, NewOrder, SetOrderDate, World, type Shop } from "../_Support";

let A: Shop;
let B: Shop;
let Main: number;
let Nasr: number;
let Maadi: number;
let Manager: Awaited<ReturnType<typeof NewMember>>;

const Range = "From=2026-03-01&To=2026-03-31";
const Report = (Token: string, Query = "") => Call("GET", `/Reports/Branches?${Range}${Query}`, { Token });
const Row = (Rows: any[], BranchId: number) => {
  const R = Rows.find((X: any) => X.BranchId === BranchId);
  return R && { OrdersCount: R.OrdersCount, Sales: R.Sales, Expenses: R.Expenses, Net: R.Net };
};

beforeEach(async () => {
  ({ A, B } = await World());
  Main = await MainBranch(A.Owner.Token);
  Nasr = await NewBranch(A.Owner.Token, "Nasr City");
  Maadi = await NewBranch(A.Owner.Token, "Maadi");
  Manager = await NewMember(A.Owner.Token, "BranchManager", Nasr);
  const NasrStaff = await NewMember(Manager.Token, "Staff");
  const MaadiStaff = await NewMember(A.Owner.Token, "Staff", Maadi);

  await SetOrderDate(await NewOrder(A.Owner.Token, A, Main), "2026-02-28T12:00:00Z");
  await SetOrderDate(await NewOrder(NasrStaff.Token, A), "2026-03-05T12:00:00Z");
  await SetOrderDate(await NewOrder(NasrStaff.Token, A, undefined, 2), "2026-03-31T10:00:00Z");
  const Cancelled = await NewOrder(NasrStaff.Token, A);
  expect((await Call("POST", `/Orders/${Cancelled}/Cancel`, { Token: NasrStaff.Token })).Status).toBe(200);
  await SetOrderDate(Cancelled, "2026-03-15T12:00:00Z");
  await SetOrderDate(await NewOrder(NasrStaff.Token, A), "2026-04-01T12:00:00Z");
  await NewExpense(NasrStaff.Token, "30.00", "2026-03-31");
  await NewExpense(NasrStaff.Token, "15.50", "2026-04-01");
  await SetOrderDate(await NewOrder(MaadiStaff.Token, A), "2026-03-20T12:00:00Z");
  await NewExpense(MaadiStaff.Token, "200.00", "2026-03-20");
  await SetOrderDate(await NewOrder(B.Owner.Token, B), "2026-03-20T12:00:00Z");
  await NewExpense(B.Owner.Token, "999.00", "2026-03-20");
});

test("r05: the owner gets correct figures for every branch, legacy data included", async () => {
  const Res = await Report(A.Owner.Token);
  expect(Res.Status).toBe(200);
  const Rows = List(Res.Body);
  expect(Row(Rows, Main)).toEqual({ OrdersCount: 1, Sales: "114.00", Expenses: "40.00", Net: "74.00" });
  expect(Row(Rows, Nasr)).toEqual({ OrdersCount: 2, Sales: "342.00", Expenses: "30.00", Net: "312.00" });
  expect(Row(Rows, Maadi)).toEqual({ OrdersCount: 1, Sales: "114.00", Expenses: "200.00", Net: "-86.00" });
  expect(Rows.find((X: any) => X.BranchId === Nasr).Name).toBe("Nasr City");
  expect(Rows.every((X: any) => [Main, Nasr, Maadi].includes(X.BranchId))).toBe(true);

  const One = List((await Report(A.Owner.Token, `&BranchId=${Nasr}`)).Body);
  expect(One.length).toBe(1);
  expect(Row(One, Nasr)).toEqual({ OrdersCount: 2, Sales: "342.00", Expenses: "30.00", Net: "312.00" });
});

test("r05: a branch manager gets the report for their own branch only", async () => {
  const Res = await Report(Manager.Token);
  expect(Res.Status).toBe(200);
  const Rows = List(Res.Body);
  expect(Row(Rows, Nasr)).toEqual({ OrdersCount: 2, Sales: "342.00", Expenses: "30.00", Net: "312.00" });
  expect(Rows.every((X: any) => X.BranchId === Nasr)).toBe(true);
});

test("r05: a branch manager cannot pull another branch's figures", async () => {
  for (const Other of [Maadi, Main]) {
    const Res = await Report(Manager.Token, `&BranchId=${Other}`);
    if (Res.Status === 200) expect(List(Res.Body).every((X: any) => X.BranchId === Nasr)).toBe(true);
    else expect([403, 404]).toContain(Res.Status);
  }
});

test("r05: other companies' branches and bad input are rejected cleanly", async () => {
  const BMain = await MainBranch(B.Owner.Token);
  for (const BranchId of [BMain, Huge]) {
    const Res = await Report(A.Owner.Token, `&BranchId=${BranchId}`);
    if (Res.Status === 200) expect(List(Res.Body).length).toBe(0);
    else expect([400, 404]).toContain(Res.Status);
  }
  const BRows = List((await Report(B.Owner.Token)).Body);
  expect(BRows.length).toBe(1);
  expect(Row(BRows, BMain)).toEqual({ OrdersCount: 2, Sales: "228.00", Expenses: "1039.00", Net: "-811.00" });
  expect((await Call("GET", "/Reports/Branches?From=2026-02-30&To=2026-03-31", { Token: A.Owner.Token })).Status).toBe(400);
  expect((await Call("GET", "/Reports/Branches?From=2026-03-01", { Token: A.Owner.Token })).Status).toBe(400);
});
