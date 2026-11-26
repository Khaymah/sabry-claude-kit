import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { Db } from "../../Database/Db";
import { Products, StockMovements } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

export const StockAdjustmentBody = z.object({
  Lines: z
    .array(
      z.object({
        ProductId: z.number().int().positive(),
        Change: z.number().int().min(-100000).max(100000).refine((V) => V !== 0, "must not be zero"),
        Reason: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(50),
});

type Line = z.infer<typeof StockAdjustmentBody>["Lines"][number];

export async function AdjustStock(CompanyId: number, UserId: number, Lines: Line[]) {
  const Results: { ProductId: number; Stock: number }[] = [];
  for (const Line of Lines) {
    const [Product] = await Db.select().from(Products).where(and(eq(Products.Id, Line.ProductId), eq(Products.CompanyId, CompanyId)));
    if (!Product) throw new AppError(404, "NOT_FOUND", `Product ${Line.ProductId} not found`);
    if (Product.Stock + Line.Change < 0) throw new AppError(409, "NEGATIVE_STOCK", `Product ${Line.ProductId} would go below zero`);
    const [Updated] = await Db.update(Products)
      .set({ Stock: sql`${Products.Stock} + ${Line.Change}` })
      .where(eq(Products.Id, Line.ProductId))
      .returning({ Stock: Products.Stock });
    await Db.insert(StockMovements).values({ CompanyId, ProductId: Line.ProductId, Change: Line.Change, Reason: Line.Reason, RefId: UserId });
    Results.push({ ProductId: Line.ProductId, Stock: Updated.Stock });
  }
  return { Applied: Results.length, Products: Results };
}
