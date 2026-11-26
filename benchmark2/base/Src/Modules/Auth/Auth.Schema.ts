import { z } from "zod";

export const LoginBody = z.object({
  Email: z.string().trim().toLowerCase().email().max(200),
  Password: z.string().min(1).max(200),
});
