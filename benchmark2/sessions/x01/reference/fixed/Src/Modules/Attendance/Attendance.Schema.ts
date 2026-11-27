import { z } from "zod";

export const AttendanceQuery = z.object({
  UserId: z.string(),
  Month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
