import { z } from "zod";
import { IdField } from "../Organizers/Organizers.Schema";

const PromoCode = z.string().trim().min(1).max(50).optional();

export const DirectPurchaseBody = z.object({
  SessionId: IdField,
  CategoryId: IdField,
  CustomerId: IdField,
  Quantity: z.number().int().min(1).max(10),
  PromoCode,
});

export const GroupBookingBody = z.object({
  CustomerId: IdField,
  PromoCode,
  Lines: z
    .array(z.object({ SessionId: IdField, CategoryId: IdField, Quantity: z.number().int().min(1).max(100) }))
    .min(1)
    .max(100)
    .refine((Lines) => Lines.reduce((Sum, L) => Sum + L.Quantity, 0) <= 100, "At most 100 tickets per booking"),
});
