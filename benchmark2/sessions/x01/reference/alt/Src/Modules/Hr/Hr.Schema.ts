import { z } from "zod";
import { AppError } from "../../Lib/Response";

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const MonthText = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const EmployeeBody = z.object({
  MonthlySalary: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  ShiftStart: Clock,
  ShiftEnd: Clock,
});

export const LeaveBody = z
  .object({ Type: z.enum(["Annual", "Unpaid"]), From: z.iso.date(), To: z.iso.date() })
  .refine((V) => V.From <= V.To && Date.parse(V.To) - Date.parse(V.From) <= 400 * 86400_000, "invalid range");

export const MonthOnly = z.object({ Month: MonthText });

export const AttendanceFilter = z.object({ UserId: z.string(), Month: MonthText });

export const PageFilter = z.object({
  Month: MonthText,
  Page: z.coerce.number().int().min(1).max(100000).default(1),
  PageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const Key = z.coerce.number().int().min(1).max(2147483647);

export function ParseKey(Value: string | undefined) {
  const Result = Key.safeParse(Value);
  if (!Result.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid id");
  return Result.data;
}
