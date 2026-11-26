import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, NewCustomer, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;
let B: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
  B = await NewCompany();
});

function Upload(Token: string, Content: string, Bom = false) {
  const Bytes = new TextEncoder().encode(Content);
  const Body = Bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...Bytes]) : Bytes;
  return Call("POST", "/Customers/Import", { Token, RawBody: Body, Headers: { "Content-Type": "text/csv" } });
}

async function Stored(CompanyId: number) {
  return Sql<{ Name: string; Phone: string | null; Email: string | null }>(
    `SELECT "Name", "Phone", "Email" FROM "Customers" WHERE "CompanyId" = $1 ORDER BY "Id"`,
    [CompanyId],
  );
}

test("an Excel file with BOM and CRLF line endings imports cleanly", async () => {
  const Csv = "Name,Phone,Email\r\nأحمد محمود,01001234567,ahmed@example.com\r\nمنى السيد,01111111111,\r\nكريم عادل,,karim@example.com\r\n";
  const Res = await Upload(A.Token, Csv, true);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Created).toBe(3);
  expect(Res.Body.Data.Errors).toEqual([]);
  const Rows = await Stored(A.CompanyId);
  expect(Rows.map((R) => R.Name)).toEqual(["أحمد محمود", "منى السيد", "كريم عادل"]);
  expect(Rows.map((R) => R.Phone ?? "")).toEqual(["01001234567", "01111111111", ""]);
  expect(Rows.map((R) => R.Email ?? "")).toEqual(["ahmed@example.com", "", "karim@example.com"]);
});

test("quoted fields with commas and quotes stay in their column", async () => {
  const Csv = 'Name,Phone,Email\n"شركة النور, للتجارة",0223456789,info@nour.example\n"مطعم ""أبو علي""",01222222222,\n';
  const Res = await Upload(A.Token, Csv);
  expect(Res.Body.Data.Created).toBe(2);
  const Rows = await Stored(A.CompanyId);
  expect(Rows[0]).toEqual({ Name: "شركة النور, للتجارة", Phone: "0223456789", Email: "info@nour.example" });
  expect(Rows[1].Name).toBe('مطعم "أبو علي"');
  expect(Rows[1].Phone).toBe("01222222222");
});

test("phones typed with Arabic digits are stored as plain digits", async () => {
  const Csv = "Name,Phone\nسارة,٠١٠٠١٢٣٤٥٦٧\nيوسف,۰۱۲۳۴۵۶۷۸۹۰\n";
  const Res = await Upload(A.Token, Csv);
  expect(Res.Body.Data.Created).toBe(2);
  expect((await Stored(A.CompanyId)).map((R) => R.Phone)).toEqual(["01001234567", "01234567890"]);
});

test("export opens correctly in Excel: UTF-8 BOM and a UTF-8 content type", async () => {
  await NewCustomer(A.CompanyId, { Name: "هالة", Phone: "01000000000" });
  const Res = await Call("GET", "/Customers/Export", { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Array.from(Res.Bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect((Res.Headers.get("Content-Type") ?? "").toLowerCase()).toContain("text/csv");
  expect((Res.Headers.get("Content-Type") ?? "").toLowerCase().replace(/\s/g, "")).toContain("charset=utf-8");
  expect(Res.Text).toContain("هالة");
});

test("export then import into another company reproduces every customer exactly", async () => {
  const Names = ["شركة النور, للتجارة", 'مطعم "أبو علي"', "عادي", "Mixed اسم, \"quoted\""];
  for (const [I, Name] of Names.entries()) await NewCustomer(A.CompanyId, { Name, Phone: I % 2 ? null : `0100000000${I}` });
  const Exported = await Call("GET", "/Customers/Export", { Token: A.Token });
  const Res = await Upload(B.Token, Exported.Text);
  expect(Res.Body.Data.Created).toBe(Names.length);
  const Before = (await Stored(A.CompanyId)).map((R) => [R.Name, R.Phone ?? "", R.Email ?? ""]);
  const After = (await Stored(B.CompanyId)).map((R) => [R.Name, R.Phone ?? "", R.Email ?? ""]);
  expect(After).toEqual(Before);
});

test("export only contains the caller's customers", async () => {
  await NewCustomer(A.CompanyId, { Name: "عميل أ" });
  await NewCustomer(B.CompanyId, { Name: "عميل ب" });
  const Res = await Call("GET", "/Customers/Export", { Token: A.Token });
  expect(Res.Text).toContain("عميل أ");
  expect(Res.Text).not.toContain("عميل ب");
});

test("bad rows are reported by file line and the rest are still imported", async () => {
  const Csv = "Phone,Name\n01000000001,ليلى\n01000000002,\n01000000003,ماجد\n";
  const Res = await Upload(A.Token, Csv);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Created).toBe(2);
  expect(Res.Body.Data.Errors.map((E: any) => E.Row)).toEqual([3]);
  expect((await Stored(A.CompanyId)).map((R) => R.Name)).toEqual(["ليلى", "ماجد"]);
});
