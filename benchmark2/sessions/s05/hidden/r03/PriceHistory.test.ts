import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, Reset } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

const History = async (Id: number, Token = A.Token) => Call("GET", `/Products/${Id}/PriceHistory`, { Token });

test("r03: every price change is kept, whichever screen made it", async () => {
  const Id = await NewProduct(A.CompanyId, { Price: "10.00" });
  await Call("PATCH", "/Products/Prices", { Token: A.Token, Body: { Items: [{ ProductId: Id, Price: "12.00" }] } });
  await Call("POST", "/Products/Prices/Increase", { Token: A.Token, Body: { Percent: 50, ProductIds: [Id] } });
  await Call("PATCH", `/Products/${Id}`, { Token: A.Token, Body: { Price: "15.00" } });
  await Call("PATCH", `/Products/${Id}`, { Token: A.Token, Body: { Name: "اسم جديد" } });
  const Res = await History(Id);
  expect(Res.Status).toBe(200);
  const Rows = Res.Body.Data.map((R: any) => [R.OldPrice, R.NewPrice]);
  expect(Rows).toEqual([["18.00", "15.00"], ["12.00", "18.00"], ["10.00", "12.00"]]);
  for (const R of Res.Body.Data) expect(Number.isNaN(new Date(R.ChangedAt).getTime())).toBe(false);
});

test("r03: another shop cannot read a product's price history", async () => {
  const Id = await NewProduct(A.CompanyId, { Price: "10.00" });
  const B = await NewCompany();
  expect((await History(Id, B.Token)).Status).toBe(404);
});
