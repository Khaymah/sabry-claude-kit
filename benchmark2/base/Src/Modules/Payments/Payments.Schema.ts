import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreatePaymentBody = z.object({
  OrderId: z.number().int().positive(),
  Amount: MoneyString,
  Method: z.enum(["Cash", "Card", "Wallet"]),
});

export const ListPaymentsQuery = z.object({
  OrderId: z.coerce.number().int().positive(),
});
