import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { Call, NewCompany, NewCustomer, NewOrder, Plan, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Late: number;

beforeAll(async () => {
  await Reset();
  A = await NewCompany();
  const Customers = [];
  for (let I = 0; I < 10; I++) Customers.push(await NewCustomer(A.CompanyId, { Name: `عميل ${I}`, Phone: `0100000000${I}` }));
  for (let I = 0; I < 150; I++) {
    const OrderId = await NewOrder(A.CompanyId, Customers[I % 10], "90.00");
    expect((await Plan(A.Token, OrderId, 3)).Status).toBe(201);
    if (I % 3 === 0) await Call("POST", `/Orders/${OrderId}/Installments/1/Pay`, { Token: A.Token, Body: { Method: "Cash" } });
    if (I === 0) Late = OrderId;
  }
  const B = await NewCompany();
  const BOrder = await NewOrder(B.CompanyId, await NewCustomer(B.CompanyId, { Name: "منافس" }), "90.00");
  await Plan(B.Token, BOrder, 3);
  setSystemTime(new Date(Date.now() + 45 * 86400_000));
}, 120000);

afterAll(() => {
  setSystemTime();
});

async function Report(Query: string) {
  QueryStats.Reset();
  const Res = await Call("GET", `/Reports/OverdueInstallments?${Query}`, { Token: A.Token });
  return { Res, Queries: QueryStats.Count };
}

test("r05: overdue installments are listed with the customer to call", async () => {
  const { Res } = await Report("Page=1&PageSize=100");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Total).toBe(250);
  const All: any[] = [...Res.Body.Data.Items];
  for (let Page = 2; Page <= 3; Page++) All.push(...(await Report(`Page=${Page}&PageSize=100`)).Res.Body.Data.Items);
  const First = All.find((I: any) => I.OrderId === Late);
  expect(First).toMatchObject({ No: 2, Amount: "30.00", CustomerName: "عميل 0", CustomerPhone: "01000000000" });
  expect(Res.Text).not.toContain("منافس");
  const Dates = All.map((I: any) => String(I.DueDate).slice(0, 10));
  expect([...Dates].sort()).toEqual(Dates);
});

test("r05: a page of the overdue list stays within a small query budget", async () => {
  const Big = await Report("Page=2&PageSize=100");
  expect(Big.Res.Body.Data.Items.length).toBe(100);
  expect(Big.Queries).toBeLessThanOrEqual(5);
  const All: any[] = [];
  for (let Page = 1; Page <= 3; Page++) All.push(...(await Report(`Page=${Page}&PageSize=100`)).Res.Body.Data.Items);
  expect(new Set(All.map((I) => `${I.OrderId}/${I.No}`)).size).toBe(250);
});
