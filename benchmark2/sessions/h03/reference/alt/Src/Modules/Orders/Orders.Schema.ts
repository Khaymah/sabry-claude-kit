import { z } from "zod";
import { IdNumber } from "../../Lib/Validate";

export const CreateOrderBody = z.object({
  CustomerId: IdNumber,
  BranchId: IdNumber.optional(),
  Items: z
    .array(z.object({ ProductId: IdNumber, Quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(100),
});

export const PayOrderBody = z.object({
  Method: z.enum(["Cash", "Card", "Wallet"]),
});
