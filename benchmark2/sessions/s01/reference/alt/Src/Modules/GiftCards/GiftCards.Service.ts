import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { GiftCardMoves, GiftCards } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

const Clean = (Code: string) => Code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

async function Find(Executor: Transaction | typeof Db, CompanyId: number, Code: string, Lock = false) {
  const Query = Executor.select().from(GiftCards).where(and(eq(GiftCards.Code, Clean(Code)), eq(GiftCards.CompanyId, CompanyId)));
  const [Card] = Lock ? await Query.for("update") : await Query;
  if (!Card) throw new AppError(404, "NOT_FOUND", "Gift card not found");
  const [{ Balance }] = await Executor.select({ Balance: sql<string>`coalesce(sum(${GiftCardMoves.Change}), 0)::numeric(12,2)::text` })
    .from(GiftCardMoves)
    .where(eq(GiftCardMoves.GiftCardId, Card.Id));
  return { Card, Balance: ToPiasters(Balance) };
}

export async function IssueGiftCard(CompanyId: number, Amount: string) {
  const Piasters = ToPiasters(Amount);
  if (Piasters <= 0) throw new AppError(400, "VALIDATION_ERROR", "Amount must be positive");
  return Db.transaction(async (Tx) => {
    const Code = randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(12, "X").slice(0, 12);
    const [Card] = await Tx.insert(GiftCards).values({ CompanyId, Code, ValidUntil: new Date(Now().getTime() + 365 * 86400_000) }).returning();
    await Tx.insert(GiftCardMoves).values({ GiftCardId: Card.Id, Change: FromPiasters(Piasters), Kind: "Issue" });
    return { Id: Card.Id, Code: Card.Code, Balance: FromPiasters(Piasters), ExpiresAt: Card.ValidUntil };
  });
}

export async function GetGiftCard(CompanyId: number, Code: string) {
  const { Card, Balance } = await Find(Db, CompanyId, Code);
  return { Code: Card.Code, Balance: FromPiasters(Balance), ExpiresAt: Card.ValidUntil };
}

export async function SpendGiftCard(Tx: Transaction, CompanyId: number, Code: string, Piasters: number) {
  const { Card, Balance } = await Find(Tx, CompanyId, Code, true);
  if (Card.ValidUntil.getTime() <= Now().getTime()) throw new AppError(409, "GIFT_CARD_EXPIRED", "Gift card has expired");
  if (Balance < Piasters) throw new AppError(409, "INSUFFICIENT_BALANCE", "Gift card balance is not enough");
  await Tx.insert(GiftCardMoves).values({ GiftCardId: Card.Id, Change: FromPiasters(-Piasters), Kind: "Spend" });
}
