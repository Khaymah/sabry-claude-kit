import { lt } from "drizzle-orm";
import { Db } from "../Database/Db";
import { Sessions } from "../Database/Schema";
import { Now } from "../Lib/Clock";

export async function CleanupExpiredSessions() {
  const Removed = await Db.delete(Sessions).where(lt(Sessions.ExpiresAt, Now())).returning({ Id: Sessions.Id });
  return Removed.length;
}
