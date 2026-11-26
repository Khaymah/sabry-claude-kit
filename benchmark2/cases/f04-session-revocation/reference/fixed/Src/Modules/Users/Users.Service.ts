import { and, eq, ne } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Sessions, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { HashPassword } from "../Auth/Auth.Service";

const PublicFields = { Id: Users.Id, CompanyId: Users.CompanyId, Email: Users.Email, Name: Users.Name, Role: Users.Role, IsActive: Users.IsActive };

export async function CreateUser(CompanyId: number, Input: { Email: string; Name: string; Password: string; Role: string }) {
  const [Existing] = await Db.select({ Id: Users.Id }).from(Users).where(eq(Users.Email, Input.Email));
  if (Existing) throw new AppError(409, "EMAIL_TAKEN", "Email already registered");
  const [User] = await Db.insert(Users)
    .values({ CompanyId, Email: Input.Email, Name: Input.Name, Role: Input.Role, PasswordHash: await HashPassword(Input.Password) })
    .returning(PublicFields);
  return User;
}

export async function ListUsers(CompanyId: number) {
  return Db.select(PublicFields).from(Users).where(eq(Users.CompanyId, CompanyId)).orderBy(Users.Id);
}

export async function SetActive(CompanyId: number, UserId: number, IsActive: boolean) {
  const [User] = await Db.update(Users)
    .set({ IsActive })
    .where(and(eq(Users.Id, UserId), eq(Users.CompanyId, CompanyId)))
    .returning(PublicFields);
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  if (!IsActive) await Db.delete(Sessions).where(eq(Sessions.UserId, UserId));
  return User;
}

export async function ChangePassword(UserId: number, CurrentSessionId: number, CurrentPassword: string, NewPassword: string) {
  const [User] = await Db.select().from(Users).where(eq(Users.Id, UserId));
  if (!User || !(await Bun.password.verify(CurrentPassword, User.PasswordHash)))
    throw new AppError(400, "INVALID_PASSWORD", "Current password is wrong");
  const PasswordHash = await HashPassword(NewPassword);
  await Db.transaction(async (Tx) => {
    await Tx.update(Users).set({ PasswordHash }).where(eq(Users.Id, UserId));
    await Tx.delete(Sessions).where(and(eq(Sessions.UserId, UserId), ne(Sessions.Id, CurrentSessionId)));
  });
}
