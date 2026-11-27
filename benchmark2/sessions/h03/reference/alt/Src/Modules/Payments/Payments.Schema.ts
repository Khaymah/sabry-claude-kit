import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";
import { IdNumber, IdQuery } from "../../Lib/Validate";

export const CreatePaymentBody = z.object({
  OrderId: IdNumber,
  Amount: MoneyString,
  Method: z.enum(["Cash", "Card", "Wallet"]),
});

export const ListPaymentsQuery = z.object({
  OrderId: IdQuery,
});
