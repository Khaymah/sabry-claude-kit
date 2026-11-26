import { z } from "zod";

export const CreateCustomerBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Phone: z.string().trim().max(30).optional(),
  Email: z.string().trim().toLowerCase().email().max(200).optional(),
});

export const UpdateCustomerBody = CreateCustomerBody.partial();

export const RedeemBody = z.object({
  Points: z.number().int().min(100).max(10_000_000).refine((V) => V % 100 === 0, "must be a multiple of 100"),
});
