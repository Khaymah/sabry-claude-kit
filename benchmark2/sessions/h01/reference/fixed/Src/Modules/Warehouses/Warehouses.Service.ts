import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Products, WarehouseMovements, WarehouseStock, Warehouses } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";

export const MainWarehouseName = "المخزن الرئيسي";

export type MovementType = "Opening" | "Adjustment" | "TransferOut" | "TransferIn" | "TransferCancel" | "Stocktake";

type Executor = Transaction | typeof Db;

export async function FindWarehouse(Executor: Executor, CompanyId: number, Id: number) {
  const [Row] = await Executor.select().from(Warehouses).where(and(eq(Warehouses.Id, Id), eq(Warehouses.CompanyId, CompanyId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Warehouse not found");
  return Row;
}

export async function RequireProducts(Executor: Executor, CompanyId: number, Ids: number[]) {
  const Unique = [...new Set(Ids)];
  const Found = await Executor.select({ Id: Products.Id }).from(Products).where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Unique)));
  if (Found.length !== Unique.length) throw new AppError(404, "NOT_FOUND", "Product not found");
}

export async function ApplyChange(
  Tx: Transaction,
  CompanyId: number,
  WarehouseId: number,
  ProductId: number,
  Change: number,
  Type: MovementType,
  RefId: number | null = null,
  Reason: string | null = null,
) {
  let Balance: number | undefined;
  if (Change > 0) {
    const [Row] = await Tx.insert(WarehouseStock)
      .values({ WarehouseId, ProductId, CompanyId, Quantity: Change })
      .onConflictDoUpdate({ target: [WarehouseStock.WarehouseId, WarehouseStock.ProductId], set: { Quantity: sql`${WarehouseStock.Quantity} + ${Change}` } })
      .returning({ Quantity: WarehouseStock.Quantity });
    Balance = Row.Quantity;
  } else {
    const [Row] = await Tx.update(WarehouseStock)
      .set({ Quantity: sql`${WarehouseStock.Quantity} + ${Change}` })
      .where(and(eq(WarehouseStock.WarehouseId, WarehouseId), eq(WarehouseStock.ProductId, ProductId), sql`${WarehouseStock.Quantity} + ${Change} >= 0`))
      .returning({ Quantity: WarehouseStock.Quantity });
    if (!Row) throw new AppError(409, "INSUFFICIENT_STOCK", `Not enough of product ${ProductId} in warehouse ${WarehouseId}`);
    Balance = Row.Quantity;
  }
  await Tx.insert(WarehouseMovements).values({ CompanyId, WarehouseId, ProductId, Change, Balance, Type, RefId, Reason });
  return Balance;
}

export async function ListWarehouses(CompanyId: number) {
  await Db.insert(Warehouses)
    .values({ CompanyId, Name: MainWarehouseName, IsMain: true })
    .onConflictDoNothing({ target: Warehouses.CompanyId, where: sql`"IsMain"` });
  return Db.select({ Id: Warehouses.Id, Name: Warehouses.Name, IsMain: Warehouses.IsMain })
    .from(Warehouses)
    .where(eq(Warehouses.CompanyId, CompanyId))
    .orderBy(asc(Warehouses.Id));
}

export async function CreateWarehouse(CompanyId: number, Name: string) {
  const [Row] = await Db.insert(Warehouses).values({ CompanyId, Name }).returning({ Id: Warehouses.Id, Name: Warehouses.Name, IsMain: Warehouses.IsMain });
  return Row;
}

export async function GetStock(CompanyId: number, WarehouseId: number) {
  await FindWarehouse(Db, CompanyId, WarehouseId);
  const Items = await Db.select({ ProductId: WarehouseStock.ProductId, Quantity: WarehouseStock.Quantity })
    .from(WarehouseStock)
    .where(eq(WarehouseStock.WarehouseId, WarehouseId))
    .orderBy(asc(WarehouseStock.ProductId));
  return { WarehouseId, Items };
}

export async function Adjust(CompanyId: number, WarehouseId: number, Input: { ProductId: number; Change: number; Reason: string }) {
  return Db.transaction(async (Tx) => {
    await FindWarehouse(Tx, CompanyId, WarehouseId);
    await RequireProducts(Tx, CompanyId, [Input.ProductId]);
    const Quantity = await ApplyChange(Tx, CompanyId, WarehouseId, Input.ProductId, Input.Change, "Adjustment", null, Input.Reason);
    return { WarehouseId, ProductId: Input.ProductId, Change: Input.Change, Quantity };
  });
}

export async function Stocktake(CompanyId: number, WarehouseId: number, Lines: { ProductId: number; Counted: number }[]) {
  return Db.transaction(async (Tx) => {
    await FindWarehouse(Tx, CompanyId, WarehouseId);
    const Ids = Lines.map((L) => L.ProductId);
    await RequireProducts(Tx, CompanyId, Ids);
    const Current = await Tx.select({ ProductId: WarehouseStock.ProductId, Quantity: WarehouseStock.Quantity })
      .from(WarehouseStock)
      .where(and(eq(WarehouseStock.WarehouseId, WarehouseId), inArray(WarehouseStock.ProductId, Ids)))
      .for("update");
    const Before = new Map(Current.map((R) => [R.ProductId, R.Quantity]));
    const Result = Lines.map((L) => {
      const Was = Before.get(L.ProductId) ?? 0;
      return { ProductId: L.ProductId, Before: Was, Counted: L.Counted, Difference: L.Counted - Was };
    });
    await Tx.insert(WarehouseStock)
      .values(Lines.map((L) => ({ WarehouseId, ProductId: L.ProductId, CompanyId, Quantity: L.Counted })))
      .onConflictDoUpdate({ target: [WarehouseStock.WarehouseId, WarehouseStock.ProductId], set: { Quantity: sql`excluded."Quantity"` } });
    const Changed = Result.filter((R) => R.Difference !== 0);
    if (Changed.length) {
      await Tx.insert(WarehouseMovements).values(
        Changed.map((R) => ({ CompanyId, WarehouseId, ProductId: R.ProductId, Change: R.Difference, Balance: R.Counted, Type: "Stocktake" })),
      );
    }
    return { WarehouseId, Lines: Result };
  });
}

export async function ListMovements(CompanyId: number, WarehouseId: number, ProductId: number) {
  await FindWarehouse(Db, CompanyId, WarehouseId);
  await RequireProducts(Db, CompanyId, [ProductId]);
  const Items = await Db.select({
    Id: WarehouseMovements.Id,
    ProductId: WarehouseMovements.ProductId,
    Change: WarehouseMovements.Change,
    Type: WarehouseMovements.Type,
    Balance: WarehouseMovements.Balance,
    RefId: WarehouseMovements.RefId,
    Reason: WarehouseMovements.Reason,
    CreatedAt: WarehouseMovements.CreatedAt,
  })
    .from(WarehouseMovements)
    .where(and(eq(WarehouseMovements.WarehouseId, WarehouseId), eq(WarehouseMovements.ProductId, ProductId)))
    .orderBy(asc(WarehouseMovements.Id));
  return { WarehouseId, ProductId, Items };
}
