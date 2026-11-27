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

async function ApplyReceipt(CompanyId: number, UserId: number, Id: number, Pick: (Items: (typeof PurchaseOrderItems.$inferSelect)[]) => Map<number, number>) {
  return Db.transaction(async (Tx) => {
    const [Po] = await Tx.select().from(PurchaseOrders).where(and(eq(PurchaseOrders.Id, Id), eq(PurchaseOrders.CompanyId, CompanyId))).for("update");
    if (!Po) throw new AppError(404, "NOT_FOUND", "Purchase order not found");
    if (Po.Status === "Received") throw new AppError(409, "INVALID_STATUS", "Purchase order was already received");
    const Items = await Tx.select().from(PurchaseOrderItems).where(eq(PurchaseOrderItems.PurchaseOrderId, Id)).orderBy(PurchaseOrderItems.Id);
    const Wanted = Pick(Items);
    for (const [ProductId, Quantity] of Wanted) {
      const Item = Items.find((I) => I.ProductId === ProductId);
      if (!Item) throw new AppError(409, "NOT_ON_ORDER", `Product ${ProductId} is not on this purchase order`);
      if (Item.ReceivedQuantity + Quantity > Item.Quantity) throw new AppError(409, "OVER_RECEIPT", `Product ${ProductId} would be received more than ordered`);
    }
    for (const [ProductId, Quantity] of Wanted) {
      if (Quantity === 0) continue;
      const Item = Items.find((I) => I.ProductId === ProductId)!;
      Item.ReceivedQuantity += Quantity;
      await Tx.update(PurchaseOrderItems).set({ ReceivedQuantity: Item.ReceivedQuantity }).where(eq(PurchaseOrderItems.Id, Item.Id));
      await Tx.update(Products).set({ Stock: sql`${Products.Stock} + ${Quantity}` }).where(eq(Products.Id, ProductId));
      await Tx.insert(StockMovements).values({ CompanyId, ProductId, Change: Quantity, Reason: "PurchaseReceived", RefId: Id });
    }
    const Complete = Items.every((I) => I.ReceivedQuantity >= I.Quantity);
    const [Updated] = await Tx.update(PurchaseOrders)
      .set(Complete ? { Status: "Received", ReceivedAt: Now() } : { Status: "PartiallyReceived" })
      .where(eq(PurchaseOrders.Id, Id))
      .returning();
    await RecordAudit({ CompanyId, UserId, Action: "Receive", Entity: "PurchaseOrder", EntityId: Id }, Tx);
    return { ...Updated, Items };
  });
}

export async function ReceiveLines(CompanyId: number, UserId: number, Id: number, Lines: { ProductId: number; Quantity: number }[]) {
  return ApplyReceipt(CompanyId, UserId, Id, () => {
    const Wanted = new Map<number, number>();
    for (const L of Lines) Wanted.set(L.ProductId, (Wanted.get(L.ProductId) ?? 0) + L.Quantity);
    return Wanted;
  });
}

export async function ReceivePurchaseOrder(CompanyId: number, UserId: number, Id: number) {
  return ApplyReceipt(CompanyId, UserId, Id, (Items) => {
    const Wanted = new Map<number, number>();
    for (const I of Items) Wanted.set(I.ProductId, (Wanted.get(I.ProductId) ?? 0) + (I.Quantity - I.ReceivedQuantity));
    return Wanted;
  });
}

export async function GetPurchaseOrder(CompanyId: number, Id: number) {
  const [Po] = await Db.select().from(PurchaseOrders).where(and(eq(PurchaseOrders.Id, Id), eq(PurchaseOrders.CompanyId, CompanyId)));
  if (!Po) throw new AppError(404, "NOT_FOUND", "Purchase order not found");
  const Items = await Db.select().from(PurchaseOrderItems).where(eq(PurchaseOrderItems.PurchaseOrderId, Id)).orderBy(PurchaseOrderItems.Id);
  return { ...Po, Items };
}

export async function ListPurchaseOrders(CompanyId: number, SupplierId?: number) {
  const Filters = [eq(PurchaseOrders.CompanyId, CompanyId)];
  if (SupplierId) Filters.push(eq(PurchaseOrders.SupplierId, SupplierId));
  return Db.select().from(PurchaseOrders).where(and(...Filters)).orderBy(desc(PurchaseOrders.Id)).limit(100);
}
