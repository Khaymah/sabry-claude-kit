import { and, eq, isNull } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { ApiKeys } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { HashApiKey } from "../../Middleware/Auth";
import { NewToken } from "../Auth/Auth.Service";

const PublicFields = { Id: ApiKeys.Id, Name: ApiKeys.Name, Prefix: ApiKeys.Prefix, CreatedAt: ApiKeys.CreatedAt, RevokedAt: ApiKeys.RevokedAt };

export async function CreateApiKey(CompanyId: number, Name: string) {
  const Key = `sk_${NewToken()}`;
  const [Row] = await Db.insert(ApiKeys)
    .values({ CompanyId, Name, Prefix: Key.slice(0, 10), KeyHash: HashApiKey(Key) })
    .returning(PublicFields);
  return { ...Row, Key };
}

export async function ListApiKeys(CompanyId: number) {
  return Db.select(PublicFields).from(ApiKeys).where(eq(ApiKeys.CompanyId, CompanyId)).orderBy(ApiKeys.Id);
}

export async function RevokeApiKey(CompanyId: number, Id: number) {
  const [Row] = await Db.update(ApiKeys)
    .set({ RevokedAt: Now() })
    .where(and(eq(ApiKeys.Id, Id), eq(ApiKeys.CompanyId, CompanyId), isNull(ApiKeys.RevokedAt)))
    .returning(PublicFields);
  if (!Row) throw new AppError(404, "NOT_FOUND", "API key not found");
  return Row;
}
