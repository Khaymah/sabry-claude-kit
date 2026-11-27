import { z } from "zod";

export const PaymentEvent = z.object({
  EventId: z.string().min(1).max(100),
  Type: z.string().min(1).max(100),
  OrderId: z.number().int().positive(),
  Amount: z.string().regex(/^\d{1,10}\.\d{2}$/),
  ProviderRef: z.string().min(1).max(100),
});
