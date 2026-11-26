import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreatePaymentBody = z.object({
  OrderId: z.number().int().positive(),
  Amount: MoneyString,
  Method: z.enum(["Cash", "Card", "Wallet", "GiftCard"]),
  GiftCardCode: z.string().max(64).optional(),
});

export const ListPaymentsQuery = z.object({
  OrderId: z.coerce.number().int().positive(),
});
