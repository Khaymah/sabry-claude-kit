import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";
import { DateText, RowId } from "../../Lib/Sales";

export const Price = MoneyString.refine((V) => Number(V) > 0, "must be greater than zero");

export const CreatePriceListBody = z
  .object({
    CustomerId: RowId,
    ValidFrom: DateText,
    ValidTo: DateText.nullable().optional(),
    Items: z
      .array(z.object({ ProductId: RowId, Price }))
      .min(1)
      .max(1000)
      .refine((Items) => new Set(Items.map((I) => I.ProductId)).size === Items.length, "each product may appear once"),
  })
  .refine((B) => !B.ValidTo || B.ValidTo >= B.ValidFrom, { message: "ValidTo must not be before ValidFrom", path: ["ValidTo"] });

export const PricesQuery = z.object({ Date: DateText.optional() });
