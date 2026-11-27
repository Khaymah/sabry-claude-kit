import { z } from "zod";

const Id = z.number().int().min(1).max(2147483647);
const Code = z.string().trim().min(1).max(50);
const Day = z.iso.date();

export const OrganizerBody = z.object({ Name: z.string().trim().min(1).max(200) });
export const StaffBody = z.object({ UserId: Id });

export const EventBody = z.object({
  OrganizerId: Id,
  Name: z.string().trim().min(1).max(200),
  Sessions: z.array(z.object({ StartsAt: z.iso.datetime({ offset: true }) })).min(1).max(50),
  Categories: z
    .array(
      z.object({
        Name: z.string().trim().min(1).max(100),
        Price: z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/),
        Capacity: z.number().int().min(1).max(50000),
      }),
    )
    .min(1)
    .max(20),
});

export const PromoBody = z.object({ Code, PercentOff: z.number().int().min(1).max(100) });

export const HoldBody = z.object({ SessionId: Id, CategoryId: Id, CustomerId: Id, Quantity: z.number().int().min(1).max(10) });

export const PurchaseHoldBody = z.object({ PromoCode: Code.optional() }).default({});

export const PurchaseBody = HoldBody.extend({ PromoCode: Code.optional() });

export const GroupBody = z.object({
  CustomerId: Id,
  PromoCode: Code.optional(),
  Lines: z.array(z.object({ SessionId: Id, CategoryId: Id, Quantity: z.number().int().min(1).max(100) })).min(1).max(100),
});

export const CheckInBody = z.object({ Code: z.string().min(1).max(100) });

export const TransferBody = z.object({ Name: z.string().trim().min(1).max(200), Phone: z.string().max(40) });

export const PayoutQuery = z.object({ From: Day, To: Day });
