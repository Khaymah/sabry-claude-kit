import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { Db } from "../Database/Db";
import { IdempotencyKeys } from "../Database/Schema";
import { AppError } from "../Lib/Response";
import { Now } from "../Lib/Clock";
import type { AppEnv } from "./Auth";

const TtlMs = 24 * 3600_000;

export const Idempotent = createMiddleware<AppEnv>(async (C, Next) => {
  const Key = C.req.header("Idempotency-Key");
  if (Key === undefined) return Next();
  if (Key.trim().length === 0 || Key.length > 255) throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key must be 1-255 characters");
  const CompanyId = C.get("Auth").CompanyId;
  const Scope = `${C.req.method} ${C.req.path}`;
  const RequestHash = createHash("sha256").update(await C.req.text()).digest("hex");
  const Where = and(eq(IdempotencyKeys.CompanyId, CompanyId), eq(IdempotencyKeys.Scope, Scope), eq(IdempotencyKeys.Key, Key));

  const [Existing] = await Db.select().from(IdempotencyKeys).where(Where);
  if (Existing && Existing.CreatedAt.getTime() + TtlMs <= Now().getTime()) {
    await Db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Existing.Id));
  }
  const [Claimed] = await Db.insert(IdempotencyKeys)
    .values({ CompanyId, Scope, Key, RequestHash, CreatedAt: Now() })
    .onConflictDoNothing()
    .returning({ Id: IdempotencyKeys.Id });

  if (!Claimed) {
    const [Row] = await Db.select().from(IdempotencyKeys).where(Where);
    if (!Row) throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this key is in progress");
    if (Row.RequestHash !== RequestHash) throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "Key was used with a different request");
    if (Row.State !== "Done") throw new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this key is in progress");
    return C.json(Row.ResponseBody as object, Row.ResponseStatus as 200);
  }

  try {
    await Next();
  } catch (Err) {
    await Db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Claimed.Id));
    throw Err;
  }
  if (C.res.status >= 500 || C.error) {
    await Db.delete(IdempotencyKeys).where(eq(IdempotencyKeys.Id, Claimed.Id));
    return;
  }
  const Body = await C.res.clone().json();
  await Db.update(IdempotencyKeys)
    .set({ State: "Done", ResponseStatus: C.res.status, ResponseBody: Body })
    .where(eq(IdempotencyKeys.Id, Claimed.Id));
});
