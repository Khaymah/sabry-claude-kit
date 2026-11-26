import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreateSupplierBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Phone: z.string().trim().max(30).optional(),
});

export const UpdateSupplierBody = CreateSupplierBody.partial();

export const SupplierPaymentBody = z.object({
  Amount: MoneyString,
  Method: z.enum(["Cash", "BankTransfer"]),
  Note: z.string().trim().max(500).optional(),
});
