import { eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { SystemSettings } from "../../Database/Schema";

export async function GetSetting<T>(Key: string, Default: T): Promise<T> {
  const [Row] = await Db.select().from(SystemSettings).where(eq(SystemSettings.Key, Key));
  return Row ? (Row.Value as T) : Default;
}

export async function SetSetting(Key: string, Value: unknown) {
  await Db.insert(SystemSettings)
    .values({ Key, Value })
    .onConflictDoUpdate({ target: SystemSettings.Key, set: { Value, UpdatedAt: new Date() } });
}
