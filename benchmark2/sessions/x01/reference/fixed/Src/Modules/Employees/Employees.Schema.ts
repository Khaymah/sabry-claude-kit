import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const ShiftTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

export const PutEmployeeBody = z.object({
  MonthlySalary: MoneyString,
  ShiftStart: ShiftTime,
  ShiftEnd: ShiftTime,
});

export const CreateLeaveBody = z
  .object({
    Type: z.enum(["Annual", "Unpaid"]),
    From: z.iso.date(),
    To: z.iso.date(),
  })
  .refine((V) => V.From <= V.To, { message: "From must not be after To", path: ["To"] })
  .refine((V) => Date.parse(V.To) - Date.parse(V.From) <= 366 * 86400_000, { message: "Leave longer than a year", path: ["To"] });
