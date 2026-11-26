import { z } from "zod";

export const CreateOrderBody = z.object({
  CustomerId: z.number().int().positive(),
  Items: z
    .array(z.object({ ProductId: z.number().int().positive(), Quantity: z.number().int().min(1).max(1000), DiscountPercent: z.number().min(0).max(100).optional() }))
    .min(1)
    .max(100),
});
