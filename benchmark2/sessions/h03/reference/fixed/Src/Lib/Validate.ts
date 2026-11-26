import type { Context } from "hono";
import { z } from "zod";
import { AppError } from "./Response";

export async function ParseBody<S extends z.ZodType>(C: Context, Schema: S): Promise<z.infer<S>> {
  let Raw: unknown;
  try {
    Raw = await C.req.json();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Body must be valid JSON");
  }
  return Check(Schema, Raw);
}

export function ParseQuery<S extends z.ZodType>(C: Context, Schema: S): z.infer<S> {
  return Check(Schema, C.req.query());
}

export const MaxId = 2_147_483_647;

export const IdNumber = z.number().int().positive().max(MaxId);

export const IdQuery = z.coerce.number().int().positive().max(MaxId);

export function ParseId(Value: string | undefined): number {
  const Id = Number(Value);
  if (!Number.isSafeInteger(Id) || Id <= 0 || Id > MaxId) throw new AppError(404, "NOT_FOUND", "Not found");
  return Id;
}

function Check<S extends z.ZodType>(Schema: S, Raw: unknown): z.infer<S> {
  const Result = Schema.safeParse(Raw);
  if (!Result.success) {
    const First = Result.error.issues[0];
    throw new AppError(400, "VALIDATION_ERROR", `${First?.path.join(".") || "body"}: ${First?.message}`);
  }
  return Result.data;
}
