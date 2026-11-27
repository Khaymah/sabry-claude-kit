import { z } from "zod";

export const CreateCouponBody = z.object({
  Code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/).transform((V) => V.toUpperCase()),
  DiscountPercent: z.number().int().min(1).max(100),
  MaxUses: z.number().int().min(1).max(1_000_000),
  ExpiresAt: z.iso.datetime({ offset: true }).optional(),
});

export const ApplyCouponBody = z.object({
  Code: z.string().trim().min(1).max(32).transform((V) => V.toUpperCase()),
});
