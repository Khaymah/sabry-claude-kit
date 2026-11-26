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

const Decimal = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a plain amount like 10 or 10.50");
const WholeNumber = (Min: number, Max: number) =>
  z
    .string()
    .regex(/^\d{1,7}$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(Min).max(Max));

export const SearchQuery = z
  .object({
    Q: z
      .string()
      .transform((V) => V.trim())
      .pipe(z.string().max(100))
      .optional(),
    MinPrice: Decimal.optional(),
    MaxPrice: Decimal.optional(),
    InStock: z.enum(["true", "false"]).optional(),
    Sort: z.enum(["PriceAsc", "PriceDesc", "Newest", "Name"]).default("Newest"),
    Page: WholeNumber(1, 1000).default(1),
    PageSize: WholeNumber(1, 50).default(20),
  })
  .refine((V) => V.MinPrice === undefined || V.MaxPrice === undefined || Number(V.MinPrice) <= Number(V.MaxPrice), {
    message: "MinPrice must not exceed MaxPrice",
    path: ["MinPrice"],
  });

export type SearchInput = z.infer<typeof SearchQuery>;
