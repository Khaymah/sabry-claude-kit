import { z } from "zod";
import { RowId } from "../../Lib/Sales";

const Discount = z
  .number()
  .min(0)
  .max(30)
  .refine((V) => Math.abs(V * 100 - Math.round(V * 100)) < 1e-6, "at most 2 decimals");

export const QuoteItems = z
  .array(z.object({ ProductId: RowId, Quantity: z.number().int().min(1).max(1_000_000), DiscountPercent: Discount.optional() }))
  .min(1)
  .max(200);

export const CreateQuoteBody = z.object({ CustomerId: RowId, Items: QuoteItems });
export const ReviseQuoteBody = z.object({ Items: QuoteItems });
