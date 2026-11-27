import { z } from "zod";

export const LoginBody = z.object({
  Email: z.string().trim().toLowerCase().email().max(200),
  Password: z.string().min(1).max(200),
});

export const ResetRequestBody = z.object({
  Email: z.string().trim().toLowerCase().max(200),
});

export const ResetConfirmBody = z.object({
  Token: z.string().min(1).max(200),
  NewPassword: z.string().min(8).max(200),
});
