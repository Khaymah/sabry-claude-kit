import { z } from "zod";

export const CreateUserBody = z.object({
  Email: z.string().trim().toLowerCase().email().max(200),
  Name: z.string().trim().min(1).max(100),
  Password: z.string().min(8).max(200),
  Role: z.enum(["Admin", "Staff"]).default("Staff"),
});

export const ChangePasswordBody = z.object({
  CurrentPassword: z.string().min(1).max(200),
  NewPassword: z.string().min(8).max(200),
});

export const InviteBody = z.object({
  Email: z.string().trim().toLowerCase().email().max(200),
  Role: z.enum(["Admin", "Staff"]),
});

export const AcceptInviteBody = z.object({
  Token: z.string().min(1).max(200),
  Name: z.string().trim().min(1).max(100),
  Password: z.string().min(8).max(200),
});

export const ChangeRoleBody = z.object({
  Role: z.enum(["Admin", "Staff"]),
});
