import { eq } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { OrderItems, Orders, Products } from "../../Database/Schema";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export async function ProductReport(CompanyId: number, Page: number, PageSize: number) {
  const All = await Db.select().from(Products).where(eq(Products.CompanyId, CompanyId)).orderBy(Products.Id);
  const Rows = [];
  for (const Product of All) {
    const Lines = await Db.select({ Quantity: OrderItems.Quantity, LineTotal: OrderItems.LineTotal, Status: Orders.Status, CreatedAt: Orders.CreatedAt })
      .from(OrderItems)
      .innerJoin(Orders, eq(Orders.Id, OrderItems.OrderId))
      .where(eq(OrderItems.ProductId, Product.Id));
    let Revenue = 0;
    let SoldQuantity = 0;
    let LastSoldAt: Date | null = null;
    for (const L of Lines) {
      SoldQuantity += L.Quantity;
      if (L.Status === "Paid") Revenue += ToPiasters(L.LineTotal);
      if (!LastSoldAt || L.CreatedAt > LastSoldAt) LastSoldAt = L.CreatedAt;
    }
    Rows.push({ ProductId: Product.Id, Name: Product.Name, Stock: Product.Stock, SoldQuantity, Revenue, LastSoldAt: LastSoldAt?.toISOString() ?? null });
  }
  Rows.sort((X, Y) => Y.Revenue - X.Revenue || X.ProductId - Y.ProductId);
  const Items = Rows.slice((Page - 1) * PageSize, Page * PageSize).map((R) => ({ ...R, Revenue: FromPiasters(R.Revenue) }));
  return { Items, Page, PageSize, Total: Rows.length };
}
