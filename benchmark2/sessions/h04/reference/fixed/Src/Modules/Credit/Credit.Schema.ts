import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreditLimitBody = z.object({ Limit: MoneyString });

export const CreditPaymentBody = z.object({
  Amount: MoneyString,
  Method: z.enum(["Cash", "Card"]),
  RequestId: z.string().trim().min(1).max(200),
});

export const WriteOffBody = z.object({ Reason: z.string().trim().min(1).max(500) });

export const AgingQuery = z.object({ Month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
