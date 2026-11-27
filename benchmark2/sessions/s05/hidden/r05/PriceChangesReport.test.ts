import { beforeAll, expect, test } from "bun:test";
import { QueryStats } from "../../../Src/Database/Db";
import { Call, NewCompany, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let From: string;
let To: string;

beforeAll(async () => {
  await Reset();
  A = await NewCompany();
  await Sql(`INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") SELECT $1, 'صنف ' || g, 'P' || g, '10.00', 5 FROM generate_series(1, 100) g`, [A.CompanyId]);
  const Ids = (await Sql<{ Id: number }>(`SELECT "Id" FROM "Products" WHERE "CompanyId" = $1 ORDER BY "Id"`, [A.CompanyId])).map((R) => R.Id);
  for (let Round = 1; Round <= 25; Round++) {
    const Res = await Call("PATCH", "/Products/Prices", { Token: A.Token, Body: { Items: Ids.map((Id) => ({ ProductId: Id, Price: `${10 + Round}.00` })) } });
    expect(Res.Status).toBe(200);
  }
  const B = await NewCompany();
  await Sql(`INSERT INTO "Products" ("CompanyId","Name","Sku","Price","Stock") VALUES ($1,'منافس','X','1.00',1)`, [B.CompanyId]);
  const [BP] = await Sql<{ Id: number }>(`SELECT "Id" FROM "Products" WHERE "CompanyId" = $1`, [B.CompanyId]);
  await Call("PATCH", "/Products/Prices", { Token: B.Token, Body: { Items: [{ ProductId: BP.Id, Price: "2.00" }] } });
  From = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  To = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}, 120000);

async function Report(Query: string) {
  QueryStats.Reset();
  const Res = await Call("GET", `/Reports/PriceChanges?${Query}`, { Token: A.Token });
  return { Res, Queries: QueryStats.Count };
}

test("r05: recent price changes are listed with the product name, newest first", async () => {
  const { Res } = await Report(`From=${From}&To=${To}&Page=1&PageSize=100`);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Total).toBe(2500);
  const First = Res.Body.Data.Items[0];
  expect(First.NewPrice).toBe("35.00");
  expect(First.OldPrice).toBe("34.00");
  expect(First.ProductName).toMatch(/^صنف \d+$/);
  expect(Res.Text).not.toContain("منافس");
  const Old = await Report(`From=2020-01-01&To=2020-12-31`);
  expect(Old.Res.Body.Data.Total).toBe(0);
});

test("r05: a page of the report stays within a small query budget", async () => {
  const { Res, Queries } = await Report(`From=${From}&To=${To}&Page=7&PageSize=100`);
  expect(Res.Body.Data.Items.length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(5);
});
