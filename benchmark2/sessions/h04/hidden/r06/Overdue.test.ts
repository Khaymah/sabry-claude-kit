import { afterEach, beforeEach, expect, test } from "bun:test";
import { At, Call, CreditOrder, MoneyText, NewCompany, NewCustomer, Pay, RealTime, Reset, SetLimit, WriteOff } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

afterEach(() => RealTime());

const Report = (Query: string, Token = A.Token) => Call("GET", `/Reports/OverdueCredit?${Query}`, { Token });

test("r06: overdue credit follows oldest-first repayments and skips written-off debts", async () => {
  At("2031-01-05T12:00:00Z");
  const Ahmed = await NewCustomer(A.CompanyId, { Name: "أحمد", Phone: "01011111111" });
  const Lost = await NewCustomer(A.CompanyId, { Name: "هارب", Phone: "01022222222" });
  await SetLimit(A.Token, Ahmed, "1000.00");
  await SetLimit(A.Token, Lost, "1000.00");
  const First = await CreditOrder(A.CompanyId, A.Token, Ahmed, "100.00");
  const Gone = await CreditOrder(A.CompanyId, A.Token, Lost, "25.00");
  const B = await NewCompany();
  const Rival = await NewCustomer(B.CompanyId, { Name: "منافس", Phone: "01099999999" });
  await SetLimit(B.Token, Rival, "1000.00");
  await CreditOrder(B.CompanyId, B.Token, Rival, "77.00");
  At("2031-01-06T12:00:00Z");
  const Second = await CreditOrder(A.CompanyId, A.Token, Ahmed, "60.00");
  At("2031-01-10T12:00:00Z");
  await WriteOff(A.Token, Gone);
  At("2031-01-20T12:00:00Z");
  const Third = await CreditOrder(A.CompanyId, A.Token, Ahmed, "40.00");
  At("2031-02-09T12:00:00Z");
  await Pay(A.Token, Ahmed, "100.00");
  At("2031-02-10T12:00:00Z");
  const Res = await Report("Page=1&PageSize=20");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Page: 1, PageSize: 20, Total: 1 });
  expect(Res.Body.Data.Items.length).toBe(1);
  const Row = Res.Body.Data.Items[0];
  expect(Row).toMatchObject({ OrderId: Second, Remaining: "60.00", DaysOverdue: 5, Customer: { Id: Ahmed, Name: "أحمد", Phone: "01011111111" } });
  expect(String(Row.DueDate).slice(0, 10)).toBe("2031-02-05");
  expect(Res.Text).not.toContain("منافس");
  expect(Res.Body.Data.Items.map((I: any) => I.OrderId)).not.toContain(First);
  expect(Res.Body.Data.Items.map((I: any) => I.OrderId)).not.toContain(Third);
  expect(Res.Body.Data.Items.map((I: any) => I.OrderId)).not.toContain(Gone);
});

test("r06: rows show what is left, oldest due first, across pages", async () => {
  const Ids: number[] = [];
  const People: number[] = [];
  for (let I = 0; I < 5; I++) {
    At(`2031-04-0${I + 1}T12:00:00Z`);
    const Person = await NewCustomer(A.CompanyId, { Name: `عميل ${I}`, Phone: `0120000000${I}` });
    await SetLimit(A.Token, Person, "1000.00");
    People.push(Person);
    Ids.push(await CreditOrder(A.CompanyId, A.Token, Person, "100.10"));
  }
  At("2031-05-20T12:00:00Z");
  await Pay(A.Token, People[2], "0.15");
  const All: any[] = [];
  for (const Page of [1, 2, 3]) {
    const Res = await Report(`Page=${Page}&PageSize=2`);
    expect(Res.Status).toBe(200);
    expect(Res.Body.Data.Total).toBe(5);
    All.push(...Res.Body.Data.Items);
  }
  expect(All.map((R) => R.OrderId)).toEqual(Ids);
  for (const R of All) {
    expect(typeof R.Remaining).toBe("string");
    expect(R.Remaining).toMatch(MoneyText);
    expect(R.Customer).toMatchObject({ Id: expect.any(Number), Name: expect.any(String), Phone: expect.any(String) });
  }
  expect(All[2]).toMatchObject({ Remaining: "99.95", Customer: { Id: People[2], Phone: "01200000002" } });
  expect(All.map((R) => R.DaysOverdue)).toEqual([19, 18, 17, 16, 15]);
  for (const Query of ["Page=0&PageSize=2", "Page=1&PageSize=1000", "Page=abc"]) expect((await Report(Query)).Status).toBe(400);
});
