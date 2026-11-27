import { and, asc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Employees, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

type Executor = Transaction | typeof Db;

export const DefaultShift = { ShiftStart: "09:00", ShiftEnd: "17:00" };

const Fields = {
  UserId: Users.Id,
  Name: Users.Name,
  MonthlySalary: sql<string>`coalesce(${Employees.MonthlySalary}, 0)::numeric(12,2)::text`,
  ShiftStart: sql<string>`coalesce(${Employees.ShiftStart}, ${DefaultShift.ShiftStart})`,
  ShiftEnd: sql<string>`coalesce(${Employees.ShiftEnd}, ${DefaultShift.ShiftEnd})`,
};

export async function ListEmployees(CompanyId: number) {
  return Db.select(Fields).from(Users).leftJoin(Employees, eq(Employees.UserId, Users.Id)).where(eq(Users.CompanyId, CompanyId)).orderBy(asc(Users.Id));
}

export async function FindEmployee(Executor: Executor, CompanyId: number, UserId: number) {
  const [Row] = await Executor.select(Fields)
    .from(Users)
    .leftJoin(Employees, eq(Employees.UserId, Users.Id))
    .where(and(eq(Users.Id, UserId), eq(Users.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Employee not found");
  return Row;
}

export async function PutEmployee(CompanyId: number, UserId: number, Input: { MonthlySalary: string; ShiftStart: string; ShiftEnd: string }) {
  await FindEmployee(Db, CompanyId, UserId);
  await Db.insert(Employees)
    .values({ UserId, CompanyId, ...Input })
    .onConflictDoUpdate({ target: Employees.UserId, set: { ...Input, UpdatedAt: sql`now()` } });
  return FindEmployee(Db, CompanyId, UserId);
}
