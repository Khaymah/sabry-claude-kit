import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreateExpenseBody = z.object({
  Category: z.string().trim().min(1).max(100),
  Amount: MoneyString,
  SpentOn: z.iso.date(),
  Note: z.string().trim().max(500).optional(),
});

export const MonthQuery = z.object({
  Month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
