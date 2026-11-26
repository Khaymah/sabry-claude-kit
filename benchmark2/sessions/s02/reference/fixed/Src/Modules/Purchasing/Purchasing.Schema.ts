import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreatePurchaseOrderBody = z.object({
  SupplierId: z.number().int().positive(),
  Items: z
    .array(z.object({ ProductId: z.number().int().positive(), Quantity: z.number().int().min(1).max(100000), UnitCost: MoneyString }))
    .min(1)
    .max(200),
});

export const ReceiptBody = z.object({
  Lines: z
    .array(z.object({ ProductId: z.number().int().positive().max(2147483647), Quantity: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(200),
});
