import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { PasswordResets, Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { SendEmail } from "../../Lib/Mailer";
import { GetSetting } from "../Settings/Settings.Service";
import { HashPassword, NewToken } from "./Auth.Service";

function Digest(Token: string) {
  return createHash("sha256").update(Token).digest("hex");
}

export async function RequestReset(Email: string) {
  const [User] = await Db.select().from(Users).where(and(eq(Users.Email, Email), eq(Users.IsActive, true)));
  if (!User) return;
  const TtlMinutes = await GetSetting<number>("Auth.ResetTokenTtlMinutes", 30);
  const Token = NewToken();
  const At = Now();
  await Db.transaction(async (Tx) => {
    await Tx.update(PasswordResets).set({ UsedAt: At }).where(and(eq(PasswordResets.UserId, User.Id), isNull(PasswordResets.UsedAt)));
    await Tx.insert(PasswordResets).values({ UserId: User.Id, TokenHash: Digest(Token), ExpiresAt: new Date(At.getTime() + TtlMinutes * 60_000) });
  });
  await SendEmail({
    To: User.Email,
    Subject: "Reset your password",
    Body: `Use this link to reset your password: https://app.example.com/reset-password?token=${Token}`,
  });
}

export async function ConfirmReset(Token: string, NewPassword: string) {
  const PasswordHash = await HashPassword(NewPassword);
  const At = Now();
  await Db.transaction(async (Tx) => {
    const [Reset] = await Tx.update(PasswordResets)
      .set({ UsedAt: At })
      .where(and(eq(PasswordResets.TokenHash, Digest(Token)), isNull(PasswordResets.UsedAt), gt(PasswordResets.ExpiresAt, At)))
      .returning();
    if (!Reset) throw new AppError(400, "INVALID_RESET_TOKEN", "Reset link is invalid or expired");
    const [User] = await Tx.update(Users)
      .set({ PasswordHash })
      .where(and(eq(Users.Id, Reset.UserId), eq(Users.IsActive, true)))
      .returning({ Id: Users.Id });
    if (!User) throw new AppError(400, "INVALID_RESET_TOKEN", "Reset link is invalid or expired");
    await Tx.delete(Sessions).where(eq(Sessions.UserId, Reset.UserId));
  });
}
