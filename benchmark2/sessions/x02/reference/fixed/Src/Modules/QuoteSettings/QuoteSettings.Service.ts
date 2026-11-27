import { eq } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { QuoteSettings } from "../../Database/Schema";

export const DefaultValidityDays = 14;

export async function ValidityDays(Ex: Transaction | typeof Db, CompanyId: number) {
  const [Row] = await Ex.select().from(QuoteSettings).where(eq(QuoteSettings.CompanyId, CompanyId));
  return Row?.ValidityDays ?? DefaultValidityDays;
}

export async function SetValidityDays(CompanyId: number, Days: number) {
  await Db.insert(QuoteSettings)
    .values({ CompanyId, ValidityDays: Days })
    .onConflictDoUpdate({ target: QuoteSettings.CompanyId, set: { ValidityDays: Days } });
  return { ValidityDays: Days };
}
