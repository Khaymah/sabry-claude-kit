import { z } from "zod";
import { IdNumber } from "../../Lib/Validate";

export const CreateUserBody = z.object({
  Email: z.string().trim().toLowerCase().email().max(200),
  Name: z.string().trim().min(1).max(100),
  Password: z.string().min(8).max(200),
  Role: z.enum(["Admin", "Staff", "BranchManager", "Cashier"]).default("Staff"),
  BranchId: IdNumber.optional(),
});

export const TransferBody = z.object({
  BranchId: IdNumber,
});

export const ChangePasswordBody = z.object({
  CurrentPassword: z.string().min(1).max(200),
  NewPassword: z.string().min(8).max(200),
});
