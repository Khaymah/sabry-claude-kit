import { and, asc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { CustomerGroups } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

type Executor = Transaction | typeof Db;
const Fields = { Id: CustomerGroups.Id, Name: CustomerGroups.Name, ApprovalThreshold: CustomerGroups.ApprovalThreshold, IsDefault: CustomerGroups.IsDefault };

export async function EnsureDefaultGroup(Ex: Executor, CompanyId: number) {
  await Ex.execute(sql`
    INSERT INTO "CustomerGroups" ("CompanyId", "Name", "ApprovalThreshold", "IsDefault")
    VALUES (${CompanyId}, 'عادي', 50000, true)
    ON CONFLICT ("CompanyId") WHERE "IsDefault" DO NOTHING`);
  const [Group] = await Ex.select(Fields)
    .from(CustomerGroups)
    .where(and(eq(CustomerGroups.CompanyId, CompanyId), eq(CustomerGroups.IsDefault, true)));
  return Group;
}

export async function ThresholdFor(Ex: Executor, CompanyId: number, GroupId: number | null) {
  if (GroupId !== null) {
    const [Group] = await Ex.select(Fields)
      .from(CustomerGroups)
      .where(and(eq(CustomerGroups.Id, GroupId), eq(CustomerGroups.CompanyId, CompanyId)));
    if (Group) return Group.ApprovalThreshold;
  }
  return (await EnsureDefaultGroup(Ex, CompanyId)).ApprovalThreshold;
}

export async function ListGroups(CompanyId: number) {
  await EnsureDefaultGroup(Db, CompanyId);
  return Db.select(Fields).from(CustomerGroups).where(eq(CustomerGroups.CompanyId, CompanyId)).orderBy(asc(CustomerGroups.Id));
}

export async function CreateGroup(CompanyId: number, Input: { Name: string; ApprovalThreshold: string }) {
  const [Group] = await Db.insert(CustomerGroups).values({ CompanyId, ...Input }).returning(Fields);
  return Group;
}

export async function UpdateGroup(CompanyId: number, Id: number, Input: { ApprovalThreshold: string }) {
  const [Group] = await Db.update(CustomerGroups)
    .set({ ApprovalThreshold: Input.ApprovalThreshold })
    .where(and(eq(CustomerGroups.Id, Id), eq(CustomerGroups.CompanyId, CompanyId)))
    .returning(Fields);
  if (!Group) throw new AppError(404, "NOT_FOUND", "Customer group not found");
  return Group;
}
