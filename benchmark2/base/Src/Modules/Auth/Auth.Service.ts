import { eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { GetSetting } from "../Settings/Settings.Service";
import { Now } from "../../Lib/Clock";

export function NewToken() {
  const Bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(Bytes).toString("base64url");
}

export async function HashPassword(Password: string) {
  return Bun.password.hash(Password, { algorithm: "bcrypt", cost: 4 });
}

export async function CreateSession(UserId: number) {
  const TtlHours = await GetSetting<number>("Auth.SessionTtlHours", 168);
  const Token = NewToken();
  const ExpiresAt = new Date(Now().getTime() + TtlHours * 3600_000);
  await Db.insert(Sessions).values({ Token, UserId, ExpiresAt });
  return { Token, ExpiresAt: ExpiresAt.toISOString() };
}

export async function Login(Email: string, Password: string) {
  const [User] = await Db.select().from(Users).where(eq(Users.Email, Email));
  const Valid = User ? await Bun.password.verify(Password, User.PasswordHash) : false;
  if (!User || !Valid || !User.IsActive) throw new AppError(401, "INVALID_CREDENTIALS", "Wrong email or password");
  return CreateSession(User.Id);
}

export async function Logout(SessionId: number) {
  await Db.delete(Sessions).where(eq(Sessions.Id, SessionId));
}

export async function GetMe(UserId: number) {
  const [User] = await Db.select({
    Id: Users.Id,
    CompanyId: Users.CompanyId,
    Email: Users.Email,
    Name: Users.Name,
    Role: Users.Role,
  })
    .from(Users)
    .where(eq(Users.Id, UserId));
  return User;
}
