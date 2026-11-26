import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

function Upload(Content: string, Bom = false, Token = A.Token) {
  const Bytes = new TextEncoder().encode(Content);
  return Call("POST", "/Expenses/Import", { Token, RawBody: Bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...Bytes]) : Bytes, Headers: { "Content-Type": "text/csv" } });
}

function ParseCsv(Text: string) {
  const Rows: string[][] = [];
  let Row: string[] = [];
  let Field = "";
  let Q = false;
  for (let I = 0; I < Text.length; I++) {
    const Ch = Text[I];
    if (Q) {
      if (Ch === '"' && Text[I + 1] === '"') (Field += '"'), I++;
      else if (Ch === '"') Q = false;
      else Field += Ch;
    } else if (Ch === '"') Q = true;
    else if (Ch === ",") Row.push(Field), (Field = "");
    else if (Ch === "\n" || Ch === "\r") {
      if (Ch === "\r" && Text[I + 1] === "\n") I++;
      Row.push(Field), Rows.push(Row), (Row = []), (Field = "");
    } else Field += Ch;
  }
  if (Field !== "" || Row.length) Row.push(Field), Rows.push(Row);
  return Rows.filter((R) => R.some((V) => V.trim() !== ""));
}

async function Stored(CompanyId = A.CompanyId) {
  return Sql<{ SpentOn: string; Category: string; Amount: string; Note: string | null }>(
    `SELECT to_char("SpentOn", 'YYYY-MM-DD') AS "SpentOn", "Category", "Amount"::text AS "Amount", "Note" FROM "Expenses" WHERE "CompanyId" = $1 ORDER BY "Id"`,
    [CompanyId],
  );
}

async function Add(CompanyId: number, SpentOn: string, Amount: string, Category = "نثريات", Note: string | null = null) {
  await Sql(`INSERT INTO "Expenses" ("CompanyId","Category","Amount","SpentOn","Note") VALUES ($1,$2,$3,$4,$5)`, [CompanyId, Category, Amount, SpentOn, Note]);
}

test("the accountant's Excel sheet imports with day-first dates and Arabic text", async () => {
  const Csv = 'Date,Category,Amount,Note\r\n03/04/2026,إيجار,12500.00,إيجار شهر أبريل\r\n15/03/2026,كهرباء,1250.5,"فاتورة, مارس"\r\n01/12/2026,"بوفيه ""الشاي""",35.75,\r\n';
  const Res = await Upload(Csv, true);
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Created).toBe(3);
  expect((await Stored()).map((R) => ({ ...R, Note: R.Note ?? "" }))).toEqual([
    { SpentOn: "2026-04-03", Category: "إيجار", Amount: "12500.00", Note: "إيجار شهر أبريل" },
    { SpentOn: "2026-03-15", Category: "كهرباء", Amount: "1250.50", Note: "فاتورة, مارس" },
    { SpentOn: "2026-12-01", Category: 'بوفيه "الشاي"', Amount: "35.75", Note: "" },
  ]);
});

test("impossible dates and bad amounts are never stored", async () => {
  const Csv = "Date,Category,Amount,Note\n31/02/2026,إيجار,100.00,\n12/31/2026,إيجار,100.00,\n10/03/2026,,100.00,\n10/03/2026,نثريات,abc,\n10/03/2026,نثريات,-5.00,\n10/03/2026,نثريات,1.005,\n";
  const Res = await Upload(Csv);
  expect(Res.Status).not.toBe(500);
  expect(await Stored()).toEqual([]);
});

test("the monthly export holds exactly that month with an exact total line", async () => {
  await Add(A.CompanyId, "2026-02-28", "999.00");
  await Add(A.CompanyId, "2026-03-01", "0.10", "إيجار");
  await Add(A.CompanyId, "2026-03-15", "0.20", "كهرباء, ومياه", 'قراءة "العداد"');
  await Add(A.CompanyId, "2026-03-31", "0.30");
  await Add(A.CompanyId, "2026-04-01", "999.00");
  const B = await NewCompany();
  await Add(B.CompanyId, "2026-03-10", "999.00");
  const Res = await Call("GET", "/Expenses/Export?Month=2026-03", { Token: A.Token });
  expect(Res.Status).toBe(200);
  expect(Array.from(Res.Bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect((Res.Headers.get("Content-Type") ?? "").toLowerCase()).toContain("text/csv");
  const Rows = ParseCsv(Res.Text.replace(/^﻿/, ""));
  expect(Rows[0].map((H) => H.trim())).toEqual(["Date", "Category", "Amount", "Note"]);
  const Data = Rows.slice(1, -1);
  expect(Data.map((R) => R[0])).toEqual(["01/03/2026", "15/03/2026", "31/03/2026"]);
  expect(Data[1].slice(1)).toEqual(["كهرباء, ومياه", "0.20", 'قراءة "العداد"']);
  const Last = Rows[Rows.length - 1];
  expect(Last[1]).toBe("الإجمالي");
  expect(Last[2]).toBe("0.60");
});

test("an export can be re-imported into another company without changes", async () => {
  await Add(A.CompanyId, "2026-05-02", "10.10", "صيانة", "تكييف, الدور الأول");
  await Add(A.CompanyId, "2026-05-20", "20.20", "رواتب");
  const Exported = await Call("GET", "/Expenses/Export?Month=2026-05", { Token: A.Token });
  const Rows = ParseCsv(Exported.Text.replace(/^﻿/, ""));
  const WithoutTotal = Rows.slice(0, -1).map((R) => R.map((V) => (/[",\n]/.test(V) ? `"${V.replace(/"/g, '""')}"` : V)).join(",")).join("\r\n");
  const B = await NewCompany();
  const Res = await Upload(WithoutTotal, true, B.Token);
  expect(Res.Body.Data.Created).toBe(2);
  const Norm = (Rows: Awaited<ReturnType<typeof Stored>>) => Rows.map((R) => ({ ...R, Note: R.Note ?? "" }));
  expect(Norm(await Stored(B.CompanyId))).toEqual(Norm(await Stored(A.CompanyId)));
});

test("a malformed month is a validation error", async () => {
  for (const Month of ["2026-13", "2026-3", "march", ""]) expect((await Call("GET", `/Expenses/Export?Month=${Month}`, { Token: A.Token })).Status).toBe(400);
});
