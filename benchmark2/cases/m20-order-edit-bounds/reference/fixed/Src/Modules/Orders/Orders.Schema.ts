import { z } from "zod";

export const CreateOrderBody = z.object({
  CustomerId: z.number().int().positive(),
  Items: z
    .array(z.object({ ProductId: z.number().int().positive(), Quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(100),
});

export const EditItemsBody = z
  .object({
    Items: z
      .array(
        z
          .object({
            ProductId: z.number().int().min(1).max(2147483647),
            Quantity: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine((Items) => new Set(Items.map((I) => I.ProductId)).size === Items.length, "each product may appear once"),
    Note: z
      .string()
      .max(500)
      .regex(/^[^\u0000-\u0009\u000B-\u001F\u007F]*$/, "must not contain control characters")
      .optional(),
  })
  .strict();
