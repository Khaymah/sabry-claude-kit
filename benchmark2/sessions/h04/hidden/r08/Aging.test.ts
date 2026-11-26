import { afterAll, beforeAll, expect, test } from "bun:test";
import { At, Call, Cancel, Cents, CreditOrder, MoneyText, NewCompany, NewCustomer, Pay, RealTime, Reset, SetLimit, WriteOff } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
const P: Record<string, number> = {};
const Buckets = ["NotDue", "Days1To30", "Days31To60", "Days61To90", "Over90", "Total"];

async function Person(Key: string, Company = A) {
  P[Key] = await NewCustomer(Company.CompanyId, { Name: Key, Phone: `010${String(Object.keys(P).length).padStart(8, "0")}` });
  await SetLimit(Company.Token, P[Key], "5000.00");
}

beforeAll(async () => {
  await Reset();
  At("2031-01-01T12:00:00Z");
  A = await NewCompany();
  const B = await NewCompany();
  for (const Key of ["Big", "Mid", "Gone", "Old", "Late"]) await Person(Key);
  await Person("Rival", B);
  At("2031-01-10T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Big, "100.00");
  await CreditOrder(B.CompanyId, B.Token, P.Rival, "999.00");
  At("2031-02-01T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Gone, "10.00");
  At("2031-02-20T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Old, "12.34");
  At("2031-03-05T12:00:00Z");
  const MidOrder = await CreditOrder(A.CompanyId, A.Token, P.Mid, "80.00");
  At("2031-04-20T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Big, "50.00");
  At("2031-05-02T12:00:00Z");
  const Returned = await CreditOrder(A.CompanyId, A.Token, P.Gone, "33.33");
  At("2031-05-03T12:00:00Z");
  expect((await Cancel(A.Token, Returned)).Status).toBe(200);
  At("2031-05-10T12:00:00Z");
  await Pay(A.Token, P.Big, "30.00");
  At("2031-05-15T12:00:00Z");
  await Pay(A.Token, P.Gone, "10.00");
  At("2031-05-25T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Big, "25.00");
  At("2031-06-05T12:00:00Z");
  await WriteOff(A.Token, MidOrder);
  At("2031-06-10T12:00:00Z");
  await Pay(A.Token, P.Big, "70.00");
  At("2031-06-15T12:00:00Z");
  await CreditOrder(A.CompanyId, A.Token, P.Late, "500.00");
  At("2031-07-01T12:00:00Z");
}, 60000);

afterAll(() => RealTime());

const Aging = (Month: string) => Call("GET", `/Reports/CreditAging?Month=${Month}`, { Token: A.Token });
const Row = (Data: any, Key: string) => Data.Items.find((I: any) => I.Customer?.Id === P[Key]);

test("r08: aging shows the debts as they stood on the last day of the month", async () => {
  const Res = await Aging("2031-05");
  expect(Res.Status).toBe(200);
  const Data = Res.Body.Data;
  expect(Data.Items.map((I: any) => I.Customer.Id)).toEqual([P.Big, P.Mid, P.Old]);
  expect(Row(Data, "Big")).toMatchObject({ NotDue: "25.00", Days1To30: "50.00", Days31To60: "0.00", Days61To90: "0.00", Over90: "70.00", Total: "145.00" });
  expect(Row(Data, "Mid")).toMatchObject({ Days31To60: "80.00", Total: "80.00" });
  expect(Row(Data, "Old")).toMatchObject({ Days61To90: "12.34", Total: "12.34" });
  expect(Row(Data, "Big").Customer).toMatchObject({ Name: "Big", Phone: expect.any(String) });
  expect(Data.Totals).toMatchObject({ NotDue: "25.00", Days1To30: "50.00", Days31To60: "80.00", Days61To90: "12.34", Over90: "70.00", Total: "237.34" });
});

test("r08: an earlier month ignores later repayments and every amount adds up", async () => {
  const Data = (await Aging("2031-04")).Body.Data;
  expect(Data.Items.map((I: any) => I.Customer.Id)).toEqual([P.Big, P.Mid, P.Old, P.Gone]);
  expect(Row(Data, "Big")).toMatchObject({ NotDue: "50.00", Days61To90: "100.00", Total: "150.00" });
  expect(Row(Data, "Mid")).toMatchObject({ Days1To30: "80.00", Total: "80.00" });
  expect(Row(Data, "Gone")).toMatchObject({ Days31To60: "10.00", Total: "10.00" });
  for (const Item of [...Data.Items, Data.Totals]) {
    for (const Key of Buckets) {
      expect(typeof Item[Key]).toBe("string");
      expect(Item[Key]).toMatch(MoneyText);
    }
    expect(Buckets.slice(0, 5).reduce((S, K) => S + Cents(Item[K]), 0)).toBe(Cents(Item.Total));
  }
  for (const Key of Buckets) expect(Data.Items.reduce((S: number, I: any) => S + Cents(I[Key]), 0)).toBe(Cents(Data.Totals[Key]));
  expect(Data.Totals.Total).toBe("252.34");
  expect(JSON.stringify(Data)).not.toContain("Rival");
  const Empty = (await Aging("2030-12")).Body.Data;
  expect(Empty.Items).toEqual([]);
  expect(Empty.Totals).toMatchObject({ NotDue: "0.00", Over90: "0.00", Total: "0.00" });
});

test("r08: a bad month is refused", async () => {
  for (const Month of ["2031-13", "2031-00", "abc", "2031-5", ""]) expect((await Aging(Month)).Status).toBe(400);
  expect((await Call("GET", "/Reports/CreditAging", { Token: A.Token })).Status).toBe(400);
});
