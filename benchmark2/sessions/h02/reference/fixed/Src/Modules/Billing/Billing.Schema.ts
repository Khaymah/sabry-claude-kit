import { z } from "zod";

const Key = z.number().int().positive().max(2147483647);
const Money = z.number().int().positive().max(100_000_000_000);

export const CreatePlanBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Price: Money,
  IntervalMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]),
});

export const SubscribeBody = z.object({ PlanId: Key });
export const ChangePlanBody = z.object({ PlanId: Key });
export const PayBody = z.object({ Method: z.enum(["Cash", "Card"]) });

export const CreateCouponBody = z.object({
  Code: z.string().trim().min(1).max(64),
  PercentOff: z.number().int().min(1).max(100),
  MaxRedemptions: z.number().int().min(1).max(1_000_000_000),
});

export const ApplyCouponBody = z.object({ Code: z.string().trim().min(1).max(64) });
export const RefundBody = z.object({ Amount: Money, Reason: z.string().max(500).optional() });
export const SplitBody = z.object({ Parts: z.number().int().min(2).max(6) });

export const DailyRevenueQuery = z.object({
  Date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((V) => {
      const D = new Date(`${V}T00:00:00Z`);
      return !Number.isNaN(D.getTime()) && D.toISOString().slice(0, 10) === V;
    }, "Invalid date"),
});
