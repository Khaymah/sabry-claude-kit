import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { GiftCards } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

const Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function NormalizeCode(Code: string) {
  return Code.toUpperCase().replace(/[\s-]/g, "");
}

function NewCode() {
  return Array.from({ length: 12 }, () => Alphabet[randomInt(Alphabet.length)]).join("");
}

export async function IssueGiftCard(CompanyId: number, Amount: string) {
  const Piasters = ToPiasters(Amount);
  if (Piasters <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  const ExpiresAt = new Date(Now().getTime() + 365 * 86400_000);
  const [Card] = await Db.insert(GiftCards)
    .values({ CompanyId, Code: NewCode(), InitialAmount: FromPiasters(Piasters), Balance: FromPiasters(Piasters), ExpiresAt })
    .returning();
  return Card;
}

export async function GetGiftCard(CompanyId: number, Code: string) {
  const [Card] = await Db.select().from(GiftCards).where(and(eq(GiftCards.Code, NormalizeCode(Code)), eq(GiftCards.CompanyId, CompanyId)));
  if (!Card) throw new AppError(404, "NOT_FOUND", "Gift card not found");
  return { Code: Card.Code, Balance: Card.Balance, InitialAmount: Card.InitialAmount, ExpiresAt: Card.ExpiresAt };
}

export async function SpendGiftCard(Tx: Transaction, CompanyId: number, Code: string, Piasters: number) {
  const [Card] = await Tx.select().from(GiftCards).where(and(eq(GiftCards.Code, NormalizeCode(Code)), eq(GiftCards.CompanyId, CompanyId)));
  if (!Card) throw new AppError(404, "NOT_FOUND", "Gift card not found");
  if (Card.ExpiresAt.getTime() <= Now().getTime()) throw new AppError(409, "GIFT_CARD_EXPIRED", "Gift card has expired");
  const [Spent] = await Tx.update(GiftCards)
    .set({ Balance: sql`${GiftCards.Balance} - ${FromPiasters(Piasters)}::numeric` })
    .where(and(eq(GiftCards.Id, Card.Id), sql`${GiftCards.Balance} >= ${FromPiasters(Piasters)}::numeric`))
    .returning({ Id: GiftCards.Id });
  if (!Spent) throw new AppError(409, "INSUFFICIENT_BALANCE", "Gift card balance is not enough");
}
