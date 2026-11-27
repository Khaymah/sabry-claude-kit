import { z } from "zod";

export const CheckoutBody = z.object({
  CardToken: z.string().trim().min(1).max(200),
});
