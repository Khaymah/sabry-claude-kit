import { z } from "zod";
import { IdField } from "../Organizers/Organizers.Schema";

export const MoneyField = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Must be an amount like 150.00");

export const CreateEventBody = z.object({
  OrganizerId: IdField,
  Name: z.string().trim().min(1).max(200),
  Sessions: z.array(z.object({ StartsAt: z.iso.datetime({ offset: true }) })).min(1).max(50),
  Categories: z
    .array(z.object({ Name: z.string().trim().min(1).max(100), Price: MoneyField, Capacity: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(20),
});

export const CreatePromoBody = z.object({
  Code: z.string().trim().min(1).max(50),
  PercentOff: z.number().int().min(1).max(100),
});
