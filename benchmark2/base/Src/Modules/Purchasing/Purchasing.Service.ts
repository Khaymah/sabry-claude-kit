import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Products, PurchaseOrderItems, PurchaseOrders, StockMovements, Suppliers } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { RecordAudit } from "../../Lib/Audit";

type PurchaseInput = { SupplierId: number; Items: { ProductId: number; Quantity: number; UnitCost: string }[] };

export async function CreatePurchaseOrder(CompanyId: number, UserId: number, Input: PurchaseInput) {
  return Db.transaction(async (Tx) => {
    const [Supplier] = await Tx.select({ Id: Suppliers.Id }).from(Suppliers).where(and(eq(Suppliers.Id, Input.SupplierId), eq(Suppliers.CompanyId, CompanyId)));
    if (!Supplier) throw new AppError(404, "NOT_FOUND", "Supplier not found");
    const Ids = Input.Items.map((I) => I.ProductId);
    const Found = await Tx.select({ Id: Products.Id }).from(Products).where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Ids)));
    if (new Set(Found.map((P) => P.Id)).size !== new Set(Ids).size) throw new AppError(404, "NOT_FOUND", "Product not found");
    const Lines = Input.Items.map((I) => ({ ...I, Cost: ToPiasters(I.UnitCost), LineTotal: ToPiasters(I.UnitCost) * I.Quantity }));
    const Total = Lines.reduce((S, L) => S + L.LineTotal, 0);
    const [Po] = await Tx.insert(PurchaseOrders).values({ CompanyId, SupplierId: Input.SupplierId, Total: FromPiasters(Total) }).returning();
    const Items = await Tx.insert(PurchaseOrderItems)
      .values(Lines.map((L) => ({ PurchaseOrderId: Po.Id, ProductId: L.ProductId, Quantity: L.Quantity, UnitCost: FromPiasters(L.Cost), LineTotal: FromPiasters(L.LineTotal) })))
      .returning();
    await RecordAudit({ CompanyId, UserId, Action: "Create", Entity: "PurchaseOrder", EntityId: Po.Id }, Tx);
    return { ...Po, Items };
  });
}

export async function ReceivePurchaseOrder(CompanyId: number, UserId: number, Id: number) {
  return Db.transaction(async (Tx) => {
    const [Po] = await Tx.update(PurchaseOrders)
      .set({ Status: "Received", ReceivedAt: Now() })
      .where(and(eq(PurchaseOrders.Id, Id), eq(PurchaseOrders.CompanyId, CompanyId), eq(PurchaseOrders.Status, "Draft")))
      .returning();
    if (!Po) {
      const [Exists] = await Tx.select({ Id: PurchaseOrders.Id }).from(PurchaseOrders).where(and(eq(PurchaseOrders.Id, Id), eq(PurchaseOrders.CompanyId, CompanyId)));
      if (!Exists) throw new AppError(404, "NOT_FOUND", "Purchase order not found");
      throw new AppError(409, "INVALID_STATUS", "Purchase order was already received");
    }
    const Items = await Tx.select().from(PurchaseOrderItems).where(eq(PurchaseOrderItems.PurchaseOrderId, Id));
    for (const Item of Items) {
      await Tx.update(Products).set({ Stock: sql`${Products.Stock} + ${Item.Quantity}` }).where(eq(Products.Id, Item.ProductId));
      await Tx.insert(StockMovements).values({ CompanyId, ProductId: Item.ProductId, Change: Item.Quantity, Reason: "PurchaseReceived", RefId: Id });
    }
    await RecordAudit({ CompanyId, UserId, Action: "Receive", Entity: "PurchaseOrder", EntityId: Id }, Tx);
    return Po;
  });
}

export async function ListPurchaseOrders(CompanyId: number, SupplierId?: number) {
  const Filters = [eq(PurchaseOrders.CompanyId, CompanyId)];
  if (SupplierId) Filters.push(eq(PurchaseOrders.SupplierId, SupplierId));
  return Db.select().from(PurchaseOrders).where(and(...Filters)).orderBy(desc(PurchaseOrders.Id)).limit(100);
}
