const Store = new Map<string, { Value: unknown; ExpiresAt: number }>();

export function CacheGet<T>(Key: string): T | undefined {
  const Hit = Store.get(Key);
  if (!Hit) return undefined;
  if (Hit.ExpiresAt < Date.now()) {
    Store.delete(Key);
    return undefined;
  }
  return Hit.Value as T;
}

export function CacheSet(Key: string, Value: unknown, TtlMs = 60_000) {
  Store.set(Key, { Value, ExpiresAt: Date.now() + TtlMs });
}
