import { Db } from "../../Database/Db";
import { Expenses } from "../../Database/Schema";
import { ParseCsv, ToCsv } from "../../Lib/Csv";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { ListExpenses } from "./Expenses.Service";

function ParseDate(Value: string): string | null {
  const Match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(Value.trim());
  if (!Match) return null;
  const [Day, Month, Year] = [Number(Match[1]), Number(Match[2]), Number(Match[3])];
  const D = new Date(Date.UTC(Year, Month - 1, Day));
  if (D.getUTCFullYear() !== Year || D.getUTCMonth() !== Month - 1 || D.getUTCDate() !== Day) return null;
  return `${Year}-${String(Month).padStart(2, "0")}-${String(Day).padStart(2, "0")}`;
}

function FormatDate(Iso: string) {
  const [Year, Month, Day] = Iso.slice(0, 10).split("-");
  return `${Day}/${Month}/${Year}`;
}

export async function ImportExpenses(CompanyId: number, Text: string) {
  const Records = ParseCsv(Text.replace(/^﻿/, ""));
  const Header = (Records[0] ?? []).map((H) => H.trim());
  const At = { Date: Header.indexOf("Date"), Category: Header.indexOf("Category"), Amount: Header.indexOf("Amount"), Note: Header.indexOf("Note") };
  const Errors: { Row: number; Message: string }[] = [];
  const Valid: { CompanyId: number; SpentOn: string; Category: string; Amount: string; Note: string | null }[] = [];
  for (let I = 1; I < Records.length; I++) {
    const Cols = Records[I];
    if (Cols.every((V) => V.trim() === "")) continue;
    const SpentOn = ParseDate(Cols[At.Date] ?? "");
    const Category = (Cols[At.Category] ?? "").trim();
    const Amount = (Cols[At.Amount] ?? "").trim();
    const Note = At.Note >= 0 ? (Cols[At.Note] ?? "").trim() : "";
    const Problem = !SpentOn ? "Date must be dd/mm/yyyy" : !Category || Category.length > 100 ? "Category is required" : !/^\d{1,10}(\.\d{1,2})?$/.test(Amount) || ToPiasters(Amount) <= 0 ? "Amount must be a positive amount" : Note.length > 500 ? "Note is too long" : null;
    if (Problem) Errors.push({ Row: I + 1, Message: Problem });
    else Valid.push({ CompanyId, SpentOn: SpentOn!, Category, Amount: FromPiasters(ToPiasters(Amount)), Note: Note || null });
  }
  if (Valid.length) await Db.insert(Expenses).values(Valid);
  return { Created: Valid.length, Errors };
}

export async function ExportMonth(CompanyId: number, Month: string) {
  const Rows = await ListExpenses(CompanyId, Month);
  const Total = Rows.reduce((S, R) => S + ToPiasters(R.Amount), 0);
  return "﻿" + ToCsv([
    ["Date", "Category", "Amount", "Note"],
    ...Rows.map((R) => [FormatDate(String(R.SpentOn)), R.Category, R.Amount, R.Note ?? ""]),
    ["", "الإجمالي", FromPiasters(Total), ""],
  ]);
}
