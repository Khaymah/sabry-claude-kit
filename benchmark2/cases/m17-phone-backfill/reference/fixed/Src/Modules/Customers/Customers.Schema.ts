import { z } from "zod";

export const CreateCustomerBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Phone: z.string().trim().max(30).optional(),
  Email: z.string().trim().toLowerCase().email().max(200).optional(),
});

export const UpdateCustomerBody = CreateCustomerBody.partial();

export const LookupQuery = z.object({
  Phone: z.string().trim().min(1).max(30),
});
