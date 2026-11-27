import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "../Middleware/Auth";

export function InBranch(Column: AnyPgColumn, BranchId: number, MainBranchId: number): SQL {
  return BranchId === MainBranchId ? (or(eq(Column, BranchId), isNull(Column)) as SQL) : eq(Column, BranchId);
}

export function EffectiveBranch(Auth: AuthContext, Stored: number | null) {
  return Stored ?? Auth.MainBranchId;
}
