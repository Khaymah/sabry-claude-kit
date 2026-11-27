import { Db, type Transaction } from "../Database/Db";
import { AuditLogs } from "../Database/Schema";

type Entry = { CompanyId: number; UserId?: number; Action: string; Entity: string; EntityId?: number };

export async function RecordAudit(Entry: Entry, Executor: Transaction | typeof Db = Db) {
  await Executor.insert(AuditLogs).values(Entry);
}
