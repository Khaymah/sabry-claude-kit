import { z } from "zod";

export const MaxId = 2147483647;
export const IdField = z.number().int().positive().max(MaxId);

export const CreateOrganizerBody = z.object({ Name: z.string().trim().min(1).max(200) });

export const AssignStaffBody = z.object({ UserId: IdField });

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((V) => {
  const D = new Date(`${V}T00:00:00Z`);
  return !Number.isNaN(D.getTime()) && D.toISOString().slice(0, 10) === V;
}, "Invalid date");

export const PayoutQuery = z
  .object({ From: Day, To: Day })
  .refine((Q) => Q.From <= Q.To, { message: "From must not be after To", path: ["From"] });
