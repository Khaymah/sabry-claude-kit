import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Products, PurchaseOrderItems, PurchaseOrders, PurchaseReceiptLines, StockMovements, Suppliers } from "../../Database/Schema";
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

async function Load(Tx: Transaction | typeof Db, CompanyId: number, Id: number) {
  const [Po] = await Tx.select().from(PurchaseOrders).where(and(eq(PurchaseOrders.Id, Id), eq(PurchaseOrders.CompanyId, CompanyId)));
  if (!Po) throw new AppError(404, "NOT_FOUND", "Purchase order not found");
  const Items = await Tx.select().from(PurchaseOrderItems).where(eq(PurchaseOrderItems.PurchaseOrderId, Id)).orderBy(PurchaseOrderItems.Id);
  const Got = await Tx.select({ ProductId: PurchaseReceiptLines.ProductId, Q: sql<number>`sum(${PurchaseReceiptLines.Quantity})::int` })
    .from(PurchaseReceiptLines)
    .where(eq(PurchaseReceiptLines.PurchaseOrderId, Id))
    .groupBy(PurchaseReceiptLines.ProductId);
  const Legacy = Po.Status === "Received" && Got.length === 0;
  const ByProduct = new Map(Got.map((G) => [G.ProductId, G.Q]));
  return { Po, Items: Items.map((I) => ({ ...I, ReceivedQuantity: Legacy ? I.Quantity : (ByProduct.get(I.ProductId) ?? 0) })) };
}

async function Apply(CompanyId: number, UserId: number, Id: number, Wanted: (Items: { ProductId: number; Quantity: number; ReceivedQuantity: number }[]) => [number, number][]) {
  return Db.transaction(async (Tx) => {
    const { Po, Items } = await Load(Tx, CompanyId, Id);
    if (Po.Status === "Received") throw new AppError(409, "INVALID_STATUS", "Purchase order was already received");
    const Plan = Wanted(Items).filter(([, Q]) => Q > 0);
    const Totals = new Map<number, number>();
    for (const [ProductId, Q] of Plan) Totals.set(ProductId, (Totals.get(ProductId) ?? 0) + Q);
    for (const [ProductId, Q] of Totals) {
      const Item = Items.find((I) => I.ProductId === ProductId);
      if (!Item) throw new AppError(409, "NOT_ON_ORDER", `Product ${ProductId} is not on this purchase order`);
      if (Item.ReceivedQuantity + Q > Item.Quantity) throw new AppError(409, "OVER_RECEIPT", `Product ${ProductId} would be over-received`);
    }
    if (Totals.size) {
      await Tx.insert(PurchaseReceiptLines).values([...Totals].map(([ProductId, Quantity]) => ({ PurchaseOrderId: Id, ProductId, Quantity })));
      for (const [ProductId, Quantity] of Totals) {
        await Tx.update(Products).set({ Stock: sql`${Products.Stock} + ${Quantity}` }).where(eq(Products.Id, ProductId));
        await Tx.insert(StockMovements).values({ CompanyId, ProductId, Change: Quantity, Reason: "PurchaseReceived", RefId: Id });
      }
    }
    const Done = Items.every((I) => I.ReceivedQuantity + (Totals.get(I.ProductId) ?? 0) >= I.Quantity);
    const [Updated] = await Tx.update(PurchaseOrders)
      .set(Done ? { Status: "Received", ReceivedAt: Now() } : { Status: "PartiallyReceived" })
      .where(eq(PurchaseOrders.Id, Id))
      .returning();
    await RecordAudit({ CompanyId, UserId, Action: "Receive", Entity: "PurchaseOrder", EntityId: Id }, Tx);
    return Updated;
  });
}

export async function ReceiveLines(CompanyId: number, UserId: number, Id: number, Lines: { ProductId: number; Quantity: number }[]) {
  await Apply(CompanyId, UserId, Id, () => Lines.map((L) => [L.ProductId, L.Quantity]));
  return GetPurchaseOrder(CompanyId, Id);
}

export async function ReceivePurchaseOrder(CompanyId: number, UserId: number, Id: number) {
  return Apply(CompanyId, UserId, Id, (Items) => Items.map((I) => [I.ProductId, I.Quantity - I.ReceivedQuantity]));
}

export async function GetPurchaseOrder(CompanyId: number, Id: number) {
  const { Po, Items } = await Load(Db, CompanyId, Id);
  return { ...Po, Items };
}

export async function ListPurchaseOrders(CompanyId: number, SupplierId?: number) {
  const Filters = [eq(PurchaseOrders.CompanyId, CompanyId)];
  if (SupplierId) Filters.push(eq(PurchaseOrders.SupplierId, SupplierId));
  return Db.select().from(PurchaseOrders).where(and(...Filters)).orderBy(desc(PurchaseOrders.Id)).limit(100);
}
