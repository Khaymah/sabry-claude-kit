import { z } from "zod";

export const CheckInBody = z.object({ Code: z.string().trim().min(1).max(100) });

export const TransferBody = z.object({
  Name: z.string().trim().min(1).max(200),
  Phone: z.string().trim().min(1).max(30),
});
