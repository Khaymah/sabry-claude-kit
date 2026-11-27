import { z } from "zod";

const Key = z.number().int().min(1).max(2_000_000_000);
const Units = z.number().int().min(1).max(100_000);

export const NewStoreBody = z.object({ Name: z.string().trim().min(1).max(120) });

export const AdjustBody = z.object({
  ProductId: Key,
  Change: z.number().int().min(-100_000).max(100_000).refine((V) => V !== 0, "zero change"),
  Reason: z.string().trim().max(500).optional(),
});

export const CountBody = z.object({
  Lines: z.array(z.object({ ProductId: Key, Counted: z.number().int().min(0).max(100_000) })).min(1).max(2000),
});

export const TransferBody = z
  .object({ FromWarehouseId: Key, ToWarehouseId: Key, Items: z.array(z.object({ ProductId: Key, Quantity: Units })).min(1).max(300) })
  .refine((B) => B.FromWarehouseId !== B.ToWarehouseId, "from and to must differ")
  .refine((B) => new Set(B.Items.map((I) => I.ProductId)).size === B.Items.length, "duplicate product");

export const LedgerQuery = z.object({ ProductId: z.string().regex(/^\d{1,9}$/).transform(Number) });
