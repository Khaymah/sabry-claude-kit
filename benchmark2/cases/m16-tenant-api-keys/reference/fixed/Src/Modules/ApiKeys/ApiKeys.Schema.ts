import { z } from "zod";

export const CreateApiKeyBody = z.object({
  Name: z.string().trim().min(1).max(100),
});
