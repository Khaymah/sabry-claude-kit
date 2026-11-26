import { and, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Products } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { ParseCsv, ToCsv } from "../../Lib/Csv";

const MaxRows = 5000;
const Columns = ["Sku", "Name", "Price", "Stock"] as const;

function Latin(Value: string) {
  return Value.replace(/[٠-٩]/g, (D) => String(D.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (D) => String(D.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .trim();
}

export async function ImportProducts(CompanyId: number, Text: string) {
  const Records = ParseCsv(Text.replace(/^﻿/, ""));
  const Header = (Records[0] ?? []).map((H) => H.trim());
  const At = Object.fromEntries(Columns.map((C) => [C, Header.indexOf(C)])) as Record<(typeof Columns)[number], number>;
  const Missing = Columns.filter((C) => At[C] < 0);
  if (Missing.length) throw new AppError(422, "IMPORT_INVALID", `Missing columns: ${Missing.join(", ")}`, { Rows: [{ Row: 1, Message: `Missing columns: ${Missing.join(", ")}` }] });
  const Data = Records.map((Cols, I) => ({ Row: I + 1, Cols })).slice(1).filter((R) => R.Cols.some((V) => V.trim() !== ""));
  if (Data.length > MaxRows) throw new AppError(413, "FILE_TOO_LARGE", `At most ${MaxRows} rows per file`);

  const Errors: { Row: number; Message: string }[] = [];
  const Seen = new Set<string>();
  const Valid: { Sku: string; Name: string; Price: string; Stock: number }[] = [];
  for (const { Row, Cols } of Data) {
    const Sku = (Cols[At.Sku] ?? "").trim();
    const Name = (Cols[At.Name] ?? "").trim();
    const Price = Latin(Cols[At.Price] ?? "");
    const Stock = Latin(Cols[At.Stock] ?? "");
    const Problem =
      !Sku || Sku.length > 64 ? "Sku is required (max 64)" :
      Seen.has(Sku) ? "Duplicate Sku in file" :
      !Name || Name.length > 200 ? "Name is required (max 200)" :
      !/^\d{1,10}(\.\d{1,2})?$/.test(Price) ? "Price must be an amount with at most 2 decimals" :
      !/^\d{1,7}$/.test(Stock) || Number(Stock) > 1_000_000 ? "Stock must be a whole number between 0 and 1000000" :
      null;
    if (Sku) Seen.add(Sku);
    if (Problem) Errors.push({ Row, Message: Problem });
    else Valid.push({ Sku, Name, Price, Stock: Number(Stock) });
  }
  if (Errors.length) throw new AppError(422, "IMPORT_INVALID", `${Errors.length} invalid rows`, { Rows: Errors });

  return Db.transaction(async (Tx) => {
    const Existing = Valid.length
      ? await Tx.select({ Sku: Products.Sku }).from(Products).where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Sku, Valid.map((V) => V.Sku))))
      : [];
    const Known = new Set(Existing.map((E) => E.Sku));
    for (let I = 0; I < Valid.length; I += 500) {
      const Chunk = Valid.slice(I, I + 500);
      await Tx.insert(Products)
        .values(Chunk.map((V) => ({ CompanyId, ...V })))
        .onConflictDoUpdate({
          target: [Products.CompanyId, Products.Sku],
          set: { Name: sqlExcluded("Name"), Price: sqlExcluded("Price"), Stock: sqlExcluded("Stock") },
        });
    }
    return { Created: Valid.filter((V) => !Known.has(V.Sku)).length, Updated: Valid.filter((V) => Known.has(V.Sku)).length };
  });
}

function sqlExcluded(Column: string) {
  return sql.raw(`excluded."${Column}"`);
}

export async function ExportProducts(CompanyId: number) {
  const Rows = await Db.select().from(Products).where(eq(Products.CompanyId, CompanyId)).orderBy(Products.Id);
  return "﻿" + ToCsv([[...Columns], ...Rows.map((R) => [R.Sku, R.Name, R.Price, String(R.Stock)])]);
}
