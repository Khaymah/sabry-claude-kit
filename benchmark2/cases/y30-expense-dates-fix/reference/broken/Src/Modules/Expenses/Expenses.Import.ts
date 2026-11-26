import { Db } from "../../Database/Db";
import { Expenses } from "../../Database/Schema";
import { ParseCsv } from "../../Lib/Csv";

function ParseDate(Value: string) {
  const D = new Date(Value.trim());
  if (Number.isNaN(D.getTime())) return null;
  return D.toISOString().slice(0, 10);
}

function ParseAmount(Value: string) {
  const N = Number(Value.trim());
  if (!Number.isFinite(N) || N <= 0) return null;
  return N.toFixed(2);
}

export async function ImportExpenses(CompanyId: number, Text: string) {
  const Records = ParseCsv(Text.replace(/^﻿/, ""));
  const Header = (Records[0] ?? []).map((H) => H.trim());
  const At = { Date: Header.indexOf("Date"), Category: Header.indexOf("Category"), Amount: Header.indexOf("Amount"), Note: Header.indexOf("Note") };
  let Created = 0;
  const Errors: { Row: number; Message: string }[] = [];
  for (let I = 1; I < Records.length; I++) {
    const Cols = Records[I];
    if (Cols.every((V) => V.trim() === "")) continue;
    const SpentOn = ParseDate(Cols[At.Date] ?? "");
    const Amount = ParseAmount(Cols[At.Amount] ?? "");
    const Category = (Cols[At.Category] ?? "").trim();
    if (!SpentOn || !Amount || !Category) {
      Errors.push({ Row: I + 1, Message: !SpentOn ? "Invalid date" : !Amount ? "Invalid amount" : "Category is required" });
      continue;
    }
    await Db.insert(Expenses).values({ CompanyId, SpentOn, Category, Amount, Note: At.Note >= 0 ? (Cols[At.Note] ?? "").trim() || null : null });
    Created++;
  }
  return { Created, Errors };
}
