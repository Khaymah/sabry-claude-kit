import { beforeAll, expect, test } from "bun:test";
import { Client, QueryStats } from "../../../Src/Database/Db";
import { Migrate } from "../../../Src/Database/Migrations";
import { Call, NewCompany, NewProduct, NewPurchaseOrder, NewSupplier, Reset, Sql } from "../_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let Fresh: number;
let Product: number;

beforeAll(async () => {
  await Reset("0001_Init");
  A = await NewCompany();
  Product = await NewProduct(A.CompanyId, { Stock: 0 });
  await Sql(`INSERT INTO "Suppliers" ("CompanyId","Name") SELECT $1, 'مورد ' || g FROM generate_series(1, 300) g`, [A.CompanyId]);
  await Sql(
    `INSERT INTO "PurchaseOrders" ("CompanyId","SupplierId","Status","Total","ReceivedAt")
     SELECT $1, s."Id", CASE WHEN k % 2 = 0 THEN 'Received' ELSE 'Draft' END, (k + 1) * 3.00, CASE WHEN k % 2 = 0 THEN now() ELSE NULL END
     FROM "Suppliers" s CROSS JOIN generate_series(0, 4) k WHERE s."CompanyId" = $1`,
    [A.CompanyId],
  );
  await Sql(
    `INSERT INTO "PurchaseOrderItems" ("PurchaseOrderId","ProductId","Quantity","UnitCost","LineTotal")
     SELECT po."Id", $1, 3, po."Total" / 3, po."Total" FROM "PurchaseOrders" po WHERE po."CompanyId" = $2`,
    [Product, A.CompanyId],
  );
  await Migrate(Client);
  Fresh = await NewSupplier(A.CompanyId, "مورد جديد");
  const Po = await NewPurchaseOrder(A.Token, Fresh, [{ ProductId: Product, Quantity: 10, UnitCost: "100.00" }]);
  await Call("POST", `/PurchaseOrders/${Po}/Receipts`, { Token: A.Token, Body: { Lines: [{ ProductId: Product, Quantity: 4 }] } });
  const B = await NewCompany();
  await NewSupplier(B.CompanyId, "منافس");
}, 120000);

async function Report(Query: string) {
  QueryStats.Reset();
  const Res = await Call("GET", `/Reports/Suppliers?${Query}`, { Token: A.Token });
  return { Res, Queries: QueryStats.Count };
}

test("r05: the supplier report counts received and open value, old orders included", async () => {
  const { Res } = await Report("Page=1&PageSize=5");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Total).toBe(301);
  const Top = Res.Body.Data.Items[0];
  expect(Top).toMatchObject({ SupplierId: Fresh, OrdersCount: 1, ReceivedValue: "400.00", OpenValue: "600.00" });
  const Old = Res.Body.Data.Items[1];
  expect(Old).toMatchObject({ OrdersCount: 5, ReceivedValue: "27.00", OpenValue: "18.00" });
});

test("r05: a page of 100 suppliers stays within a small query budget", async () => {
  const { Res, Queries } = await Report("Page=2&PageSize=100");
  expect(Res.Body.Data.Items.length).toBe(100);
  expect(Queries).toBeLessThanOrEqual(5);
  const Small = await Report("Page=1&PageSize=5");
  expect(Small.Queries).toBeLessThanOrEqual(5);
});

test("r05: paging lists every supplier once, highest received value first", async () => {
  const All: any[] = [];
  for (let Page = 1; Page <= 4; Page++) All.push(...(await Report(`Page=${Page}&PageSize=100`)).Res.Body.Data.Items);
  expect(new Set(All.map((R) => R.SupplierId)).size).toBe(301);
  for (let I = 1; I < All.length; I++) {
    const P = Number(All[I - 1].ReceivedValue);
    const C = Number(All[I].ReceivedValue);
    expect(P > C || (P === C && All[I - 1].SupplierId < All[I].SupplierId)).toBe(true);
  }
  expect(All.some((R) => R.Name === "منافس")).toBe(false);
});
