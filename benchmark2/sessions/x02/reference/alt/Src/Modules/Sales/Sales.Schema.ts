import { z } from "zod";

const Id = z.number().int().min(1).max(2_147_483_647);
const Day = z.iso.date();
const Amount = z
  .union([z.string(), z.number()])
  .transform((V) => (typeof V === "number" ? String(V) : V.trim()))
  .refine((V) => /^\d{1,10}(\.\d{1,2})?$/.test(V), "must be an amount with at most 2 decimals");

const Lines = z
  .array(
    z.object({
      ProductId: Id,
      Quantity: z.number().int().min(1).max(100_000),
      DiscountPercent: z.number().min(0).max(30).multipleOf(0.01).default(0),
    }),
  )
  .min(1)
  .max(100);

export const PriceListBody = z
  .object({
    CustomerId: Id,
    ValidFrom: Day,
    ValidTo: Day.optional(),
    Items: z.array(z.object({ ProductId: Id, Price: Amount.refine((V) => Number(V) > 0, "must be above zero") })).min(1).max(1000),
  })
  .refine((B) => new Set(B.Items.map((I) => I.ProductId)).size === B.Items.length, { message: "duplicate product", path: ["Items"] })
  .refine((B) => B.ValidTo === undefined || B.ValidTo >= B.ValidFrom, { message: "ValidTo before ValidFrom", path: ["ValidTo"] });

export const PricesQuery = z.object({ Date: Day.optional() });
export const QuoteBody = z.object({ CustomerId: Id, Items: Lines });
export const RevisionBody = z.object({ Items: Lines });
export const SettingsBody = z.object({ ValidityDays: z.number().int().min(1).max(365) });
export const GroupBody = z.object({ Name: z.string().trim().min(1).max(100), ApprovalThreshold: Amount });
export const GroupPatchBody = z.object({ ApprovalThreshold: Amount });
export const GroupIdBody = z.object({ GroupId: Id });
