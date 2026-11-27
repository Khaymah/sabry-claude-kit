import { z } from "zod";

export const CreateSupplierBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Phone: z.string().trim().max(30).optional(),
});

export const UpdateSupplierBody = CreateSupplierBody.partial();
