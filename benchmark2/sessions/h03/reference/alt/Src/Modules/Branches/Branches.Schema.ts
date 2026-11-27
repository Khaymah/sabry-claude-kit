import { z } from "zod";
import { IdNumber } from "../../Lib/Validate";

export const CreateBranchBody = z.object({
  Name: z.string().trim().min(1).max(100),
});

export const CloseBranchBody = z.object({
  MoveStaffTo: IdNumber,
});
