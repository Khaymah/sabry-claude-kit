import { z } from "zod";
import { MoneyString } from "../Products/Products.Schema";

export const CreateGroupBody = z.object({ Name: z.string().trim().min(1).max(100), ApprovalThreshold: MoneyString });
export const UpdateGroupBody = z.object({ ApprovalThreshold: MoneyString });
