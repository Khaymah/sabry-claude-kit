import { Db } from "../../Database/Db";
import { Expenses } from "../../Database/Schema";
import { ParseCsv } from "../../Lib/Csv";

function Latin(Value: string) {
  return Value.replace(/[٠-٩]/g, (D) => String(D.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (D) => String(D.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .trim();
}

function ValidDate(Year: number, Month: number, Day: number) {
  const D = new Date(Date.UTC(Year, Month - 1, Day));
  if (D.getUTCFullYear() !== Year || D.getUTCMonth() !== Month - 1 || D.getUTCDate() !== Day) return null;
  return `${Year}-${String(Month).padStart(2, "0")}-${String(Day).padStart(2, "0")}`;
}

function ParseDate(Value: string) {
  const Text = Latin(Value);
  let M = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(Text);
  if (M) return ValidDate(Number(M[1]), Number(M[2]), Number(M[3]));
  M = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(Text);
  if (M) return ValidDate(Number(M[3]), Number(M[2]), Number(M[1]));
  return null;
}

function ParseAmount(Value: string) {
  const Text = Latin(Value).replace(/,(?=\d{3}(\D|$))/g, "");
  const M = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(Text);
  if (!M) return null;
  const Piasters = Number(M[1]) * 100 + Number((M[2] ?? "").padEnd(2, "0"));
  if (Piasters <= 0) return null;
  return `${Math.floor(Piasters / 100)}.${String(Piasters % 100).padStart(2, "0")}`;
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
