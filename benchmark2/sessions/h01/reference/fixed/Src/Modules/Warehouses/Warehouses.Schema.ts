import { z } from "zod";

export const RowId = z.number().int().positive().max(2_147_483_647);
export const Quantity = z.number().int().min(1).max(1_000_000);

export const CreateWarehouseBody = z.object({ Name: z.string().trim().min(1).max(200) });

export const AdjustmentBody = z.object({
  ProductId: RowId,
  Change: z.number().int().min(-1_000_000).max(1_000_000).refine((V) => V !== 0, "must not be zero"),
  Reason: z.string().trim().min(1).max(500),
});

export const StocktakeBody = z.object({
  Lines: z
    .array(z.object({ ProductId: RowId, Counted: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(5000)
    .refine((Lines) => new Set(Lines.map((L) => L.ProductId)).size === Lines.length, "each product may appear once"),
});

export const MovementsQuery = z.object({ ProductId: z.coerce.number().int().positive().max(2_147_483_647) });
