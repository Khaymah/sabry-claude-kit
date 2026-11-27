import { z } from "zod";

export const MoneyString = z
  .union([z.string(), z.number()])
  .transform((V) => (typeof V === "number" ? String(V) : V.trim()))
  .refine((V) => /^\d{1,10}(\.\d{1,2})?$/.test(V), "must be a non-negative amount with at most 2 decimals");

export const CreateProductBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Sku: z.string().trim().min(1).max(64),
  Price: MoneyString,
  Stock: z.number().int().min(0).max(1_000_000).default(0),
});

export const UpdateProductBody = z.object({
  Name: z.string().trim().min(1).max(200).optional(),
  Price: MoneyString.optional(),
  Stock: z.number().int().min(0).max(1_000_000).optional(),
  IsActive: z.boolean().optional(),
});
