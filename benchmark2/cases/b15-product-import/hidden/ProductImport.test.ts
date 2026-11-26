import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewProduct, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
});

function Upload(Content: string, Options: { Bom?: boolean; Token?: string } = {}) {
  const Bytes = new TextEncoder().encode(Content);
  const Body = Options.Bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...Bytes]) : Bytes;
  return Call("POST", "/Products/Import", { Token: Options.Token ?? A.Token, RawBody: Body, Headers: { "Content-Type": "text/csv" } });
}

async function Stored(CompanyId = A.CompanyId) {
  return Sql<{ Id: number; Sku: string; Name: string; Price: string; Stock: number }>(
    `SELECT "Id", "Sku", "Name", "Price"::text AS "Price", "Stock" FROM "Products" WHERE "CompanyId" = $1 ORDER BY "Sku"`,
    [CompanyId],
  );
}

test("an Excel export with BOM, CRLF and Arabic names imports exactly", async () => {
  const Csv = "Sku,Name,Price,Stock\r\nP-1,زيت زيتون بكر,150.50,12\r\nP-2,عسل نحل,85,0\r\n";
  const Res = await Upload(Csv, { Bom: true });
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Created: 2, Updated: 0 });
  expect((await Stored()).map(({ Id, ...R }) => R)).toEqual([
    { Sku: "P-1", Name: "زيت زيتون بكر", Price: "150.50", Stock: 12 },
    { Sku: "P-2", Name: "عسل نحل", Price: "85.00", Stock: 0 },
  ]);
});

test("numbers typed with Arabic digits and the Arabic decimal mark are understood", async () => {
  const Csv = "Name,Sku,Stock,Price\nشاي,T-1,١٢,١٥٠٫٥٠\nقهوة,C-1,۲۰,۹۹\n";
  const Res = await Upload(Csv);
  expect(Res.Status).toBe(200);
  expect((await Stored()).map((R) => [R.Sku, R.Price, R.Stock])).toEqual([
    ["C-1", "99.00", 20],
    ["T-1", "150.50", 12],
  ]);
});

test("quoted names keep commas and quotes", async () => {
  const Csv = 'Sku,Name,Price,Stock\nQ-1,"طقم كاسات, 6 قطع",120.00,3\nQ-2,"مج ""الأهلي""",45.00,7\n';
  expect((await Upload(Csv)).Status).toBe(200);
  expect((await Stored()).map((R) => R.Name)).toEqual(["طقم كاسات, 6 قطع", 'مج "الأهلي"']);
});

test("one bad row rejects the whole file and reports every bad line", async () => {
  const Existing = await NewProduct(A.CompanyId, { Sku: "OLD", Name: "قديم", Price: "10.00", Stock: 5 });
  const Csv = "Sku,Name,Price,Stock\nOLD,جديد,20.00,9\nN-1,سليم,10.00,1\nN-2,,10.00,1\nN-3,سعر غلط,10.005,1\nN-4,مخزون سالب,10.00,-2\nN-5,كسر,10.00,1.5\n";
  const Res = await Upload(Csv);
  expect(Res.Status).toBe(422);
  expect(Res.Body.Success).toBe(false);
  expect(Res.Body.Error.Code).toBe("IMPORT_INVALID");
  expect(Res.Body.Error.Rows.map((R: any) => R.Row)).toEqual([4, 5, 6, 7]);
  const Rows = await Stored();
  expect(Rows).toEqual([{ Id: Existing, Sku: "OLD", Name: "قديم", Price: "10.00", Stock: 5 }]);
});

test("a SKU repeated inside the file is an error on its second line", async () => {
  const Csv = "Sku,Name,Price,Stock\nD-1,أ,1.00,1\nD-2,ب,1.00,1\nD-1,ج,1.00,1\n";
  const Res = await Upload(Csv);
  expect(Res.Status).toBe(422);
  expect(Res.Body.Error.Rows.map((R: any) => R.Row)).toEqual([4]);
  expect(await Stored()).toEqual([]);
});

test("existing SKUs are updated in place and other companies are untouched", async () => {
  const Mine = await NewProduct(A.CompanyId, { Sku: "S-1", Name: "قديم", Price: "1.00", Stock: 1 });
  const Theirs = await NewProduct(B.CompanyId, { Sku: "S-1", Name: "بتاعهم", Price: "7.00", Stock: 7 });
  const Res = await Upload("Sku,Name,Price,Stock\nS-1,محدث,2.50,4\nS-2,جديد,3.00,1\n");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Created: 1, Updated: 1 });
  const Rows = await Stored();
  expect(Rows[0]).toEqual({ Id: Mine, Sku: "S-1", Name: "محدث", Price: "2.50", Stock: 4 });
  expect(await Stored(B.CompanyId)).toEqual([{ Id: Theirs, Sku: "S-1", Name: "بتاعهم", Price: "7.00", Stock: 7 }]);
});

test("files over 5000 rows are refused, 5000 rows are accepted", async () => {
  const Lines = (N: number) => ["Sku,Name,Price,Stock", ...Array.from({ length: N }, (_, I) => `BULK-${I},منتج ${I},${(I % 100) + 1}.25,${I % 50}`)].join("\n");
  const Big = await Upload(Lines(5001));
  expect(Big.Status).toBe(413);
  expect(await Stored()).toEqual([]);
  const Ok = await Upload(Lines(5000));
  expect(Ok.Status).toBe(200);
  expect(Ok.Body.Data.Created).toBe(5000);
}, 90000);

test("export round-trips through import without changing anything", async () => {
  await Upload('Sku,Name,Price,Stock\nR-1,"اسم, بفاصلة",10.10,1\nR-2,"اسم ""بعلامة""",0.99,0\nR-3,عادي,1000.00,999\n');
  const Before = await Stored();
  const Exported = await Call("GET", "/Products/Export", { Token: A.Token });
  expect(Exported.Status).toBe(200);
  expect(Array.from(Exported.Bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect((Exported.Headers.get("Content-Type") ?? "").toLowerCase()).toContain("text/csv");
  const Res = await Upload(Exported.Text);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data).toMatchObject({ Created: 0, Updated: 3 });
  expect(await Stored()).toEqual(Before);
  const Other = await Call("GET", "/Products/Export", { Token: B.Token });
  expect(Other.Text).not.toContain("R-1");
});
