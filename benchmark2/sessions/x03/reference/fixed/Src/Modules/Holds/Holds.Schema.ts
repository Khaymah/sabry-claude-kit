import { z } from "zod";
import { IdField } from "../Organizers/Organizers.Schema";

export const CreateHoldBody = z.object({
  SessionId: IdField,
  CategoryId: IdField,
  CustomerId: IdField,
  Quantity: z.number().int().min(1).max(10),
});

export const PurchaseHoldBody = z.object({ PromoCode: z.string().trim().min(1).max(50).optional() });
