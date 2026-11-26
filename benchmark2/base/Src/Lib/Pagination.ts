import { z } from "zod";

export const PageQuery = z.object({
  Page: z.coerce.number().int().min(1).max(100000).default(1),
  PageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function PageMeta(Page: number, PageSize: number, Total: number) {
  return { Page, PageSize, Total, TotalPages: Math.ceil(Total / PageSize) };
}
