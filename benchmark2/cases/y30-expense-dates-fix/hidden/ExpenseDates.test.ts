import { beforeEach, expect, test } from "bun:test";
import { Call, NewCompany, Reset, Sql } from "./_Support";

let A: Awaited<ReturnType<typeof NewCompany>>;

beforeEach(async () => {
  await Reset();
  A = await NewCompany();
});

function Upload(Content: string) {
  return Call("POST", "/Expenses/Import", { Token: A.Token, RawBody: new TextEncoder().encode(Content), Headers: { "Content-Type": "text/csv" } });
}

async function Stored() {
  return Sql<{ SpentOn: string; Amount: string; Category: string }>(
    `SELECT to_char("SpentOn", 'YYYY-MM-DD') AS "SpentOn", "Amount"::text AS "Amount", "Category" FROM "Expenses" WHERE "CompanyId" = $1 ORDER BY "Id"`,
    [A.CompanyId],
  );
}

test("day-first dates from the accountant's sheet land on the right day", async () => {
  const Res = await Upload("Date,Category,Amount\n05/03/2026,إيجار,100\n12/03/2026,كهرباء,50\n31/03/2026,مياه,20\n");
  expect(Res.Status).toBe(200);
  expect(Res.Body.Data.Created).toBe(3);
  expect((await Stored()).map((R) => R.SpentOn)).toEqual(["2026-03-05", "2026-03-12", "2026-03-31"]);
});

test("ISO dates and dashed dates are understood too", async () => {
  await Upload("Date,Category,Amount\n2026-03-05,أ,1\n5-3-2026,ب,1\n7/3/2026,ج,1\n");
  expect((await Stored()).map((R) => R.SpentOn)).toEqual(["2026-03-05", "2026-03-05", "2026-03-07"]);
});

test("dates and amounts typed with Arabic digits are accepted", async () => {
  const Res = await Upload("Date,Category,Amount\n٠٥/٠٣/٢٠٢٦,نثريات,١٢٥٫٥٠\n۱۰/۰۳/۲۰۲۶,نثريات,۲۰\n");
  expect(Res.Body.Data.Created).toBe(2);
  expect(await Stored()).toEqual([
    { SpentOn: "2026-03-05", Amount: "125.50", Category: "نثريات" },
    { SpentOn: "2026-03-10", Amount: "20.00", Category: "نثريات" },
  ]);
});

test("amounts with thousands separators keep their value", async () => {
  await Upload('Date,Category,Amount\n01/03/2026,رواتب,"12,500.00"\n02/03/2026,رواتب,"1,250.5"\n');
  expect((await Stored()).map((R) => R.Amount)).toEqual(["12500.00", "1250.50"]);
});

test("impossible dates are rejected by line and the good lines still go in", async () => {
  const Res = await Upload("Date,Category,Amount\n31/02/2026,أ,1\n10/03/2026,ب,1\n13/13/2026,ج,1\n");
  expect(Res.Body.Data.Created).toBe(1);
  expect(Res.Body.Data.Errors.map((E: any) => E.Row)).toEqual([2, 4]);
  expect((await Stored()).map((R) => R.SpentOn)).toEqual(["2026-03-10"]);
});

test("the March totals include every March expense from the sheet", async () => {
  await Upload("Date,Category,Amount\n01/03/2026,إيجار,1000\n11/03/2026,إيجار,0.10\n31/03/2026,إيجار,0.20\n01/04/2026,إيجار,999\n");
  const Res = await Call("GET", "/Expenses/Totals?Month=2026-03", { Token: A.Token });
  expect(Res.Body.Data).toEqual([{ Category: "إيجار", Total: "1000.30" }]);
});
