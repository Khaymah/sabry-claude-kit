import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Invites, Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { SendEmail } from "../../Lib/Mailer";
import { HashPassword, NewToken } from "../Auth/Auth.Service";
import { GetSetting } from "../Settings/Settings.Service";

const Digest = (Token: string) => createHash("sha256").update(Token).digest("hex");

export async function InviteUser(CompanyId: number, InvitedBy: number, Email: string, Role: string) {
  const [Existing] = await Db.select({ Id: Users.Id }).from(Users).where(eq(Users.Email, Email));
  if (Existing) throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
  const Token = NewToken();
  const [Invite] = await Db.insert(Invites)
    .values({ CompanyId, Email, Role, InvitedBy, TokenHash: Digest(Token), ExpiresAt: new Date(Now().getTime() + 7 * 86400_000) })
    .returning({ Id: Invites.Id, Email: Invites.Email, Role: Invites.Role, ExpiresAt: Invites.ExpiresAt });
  await SendEmail({ To: Email, Subject: "You are invited", Body: `Join your team: https://app.example.com/accept-invite?token=${Token}` });
  return Invite;
}

export async function AcceptInvite(Token: string, Name: string, Password: string) {
  const PasswordHash = await HashPassword(Password);
  const TtlHours = await GetSetting<number>("Auth.SessionTtlHours", 168);
  const At = Now();
  return Db.transaction(async (Tx) => {
    const [Invite] = await Tx.update(Invites)
      .set({ AcceptedAt: At })
      .where(and(eq(Invites.TokenHash, Digest(Token)), isNull(Invites.AcceptedAt), gt(Invites.ExpiresAt, At)))
      .returning();
    if (!Invite) throw new AppError(400, "INVALID_INVITE", "Invite link is invalid or expired");
    const [Taken] = await Tx.select({ Id: Users.Id }).from(Users).where(eq(Users.Email, Invite.Email));
    if (Taken) throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
    const [User] = await Tx.insert(Users)
      .values({ CompanyId: Invite.CompanyId, Email: Invite.Email, Name, Role: Invite.Role, PasswordHash })
      .returning({ Id: Users.Id, CompanyId: Users.CompanyId, Email: Users.Email, Name: Users.Name, Role: Users.Role });
    const SessionToken = NewToken();
    const ExpiresAt = new Date(At.getTime() + TtlHours * 3600_000);
    await Tx.insert(Sessions).values({ Token: SessionToken, UserId: User.Id, ExpiresAt });
    return { User, Token: SessionToken, ExpiresAt: ExpiresAt.toISOString() };
  });
}

export async function ChangeRole(CompanyId: number, UserId: number, Role: string) {
  const [Target] = await Db.select().from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, CompanyId)));
  if (!Target) throw new AppError(404, "NOT_FOUND", "User not found");
  if (Target.Role === "Owner") throw new AppError(409, "CANNOT_CHANGE_OWNER", "The owner's role cannot be changed");
  const [User] = await Db.update(Users)
    .set({ Role })
    .where(eq(Users.Id, UserId))
    .returning({ Id: Users.Id, CompanyId: Users.CompanyId, Email: Users.Email, Name: Users.Name, Role: Users.Role });
  return User;
}
