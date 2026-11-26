import { and, asc, eq, inArray } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { TransferItems, Transfers } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { ApplyChange, FindWarehouse, RequireProducts } from "../Warehouses/Warehouses.Service";

type TransferInput = { FromWarehouseId: number; ToWarehouseId: number; Items: { ProductId: number; Quantity: number }[] };

async function Load(Executor: Transaction | typeof Db, CompanyId: number, Id: number) {
  const [Transfer] = await Executor.select().from(Transfers).where(and(eq(Transfers.Id, Id), eq(Transfers.CompanyId, CompanyId)));
  if (!Transfer) throw new AppError(404, "NOT_FOUND", "Transfer not found");
  const Items = await Executor.select({ ProductId: TransferItems.ProductId, Quantity: TransferItems.Quantity })
    .from(TransferItems)
    .where(eq(TransferItems.TransferId, Id))
    .orderBy(asc(TransferItems.Id));
  return { ...Transfer, Items };
}

async function LockTransfer(Tx: Transaction, CompanyId: number, Id: number) {
  const [Transfer] = await Tx.select().from(Transfers).where(and(eq(Transfers.Id, Id), eq(Transfers.CompanyId, CompanyId))).for("update");
  if (!Transfer) throw new AppError(404, "NOT_FOUND", "Transfer not found");
  const Items = await Tx.select().from(TransferItems).where(eq(TransferItems.TransferId, Id)).orderBy(asc(TransferItems.Id));
  return { Transfer, Items };
}

export async function GetTransfer(CompanyId: number, Id: number) {
  return Load(Db, CompanyId, Id);
}

export async function CreateTransfer(CompanyId: number, Input: TransferInput) {
  if (Input.FromWarehouseId === Input.ToWarehouseId) throw new AppError(400, "VALIDATION_ERROR", "A transfer needs two different warehouses");
  const Id = await Db.transaction(async (Tx) => {
    await FindWarehouse(Tx, CompanyId, Input.FromWarehouseId);
    await FindWarehouse(Tx, CompanyId, Input.ToWarehouseId);
    await RequireProducts(Tx, CompanyId, Input.Items.map((I) => I.ProductId));
    const [Transfer] = await Tx.insert(Transfers)
      .values({ CompanyId, FromWarehouseId: Input.FromWarehouseId, ToWarehouseId: Input.ToWarehouseId })
      .returning({ Id: Transfers.Id });
    await Tx.insert(TransferItems).values(Input.Items.map((I) => ({ TransferId: Transfer.Id, ProductId: I.ProductId, Quantity: I.Quantity })));
    for (const Item of Input.Items) {
      await ApplyChange(Tx, CompanyId, Input.FromWarehouseId, Item.ProductId, -Item.Quantity, "TransferOut", Transfer.Id);
    }
    return Transfer.Id;
  });
  return Load(Db, CompanyId, Id);
}

export async function ReceiveTransfer(CompanyId: number, Id: number) {
  await Db.transaction(async (Tx) => {
    const { Transfer, Items } = await LockTransfer(Tx, CompanyId, Id);
    if (Transfer.Status !== "InTransit") throw new AppError(409, "INVALID_STATUS", `Transfer is ${Transfer.Status}`);
    await Tx.update(Transfers).set({ Status: "Received", ReceivedAt: Now() }).where(eq(Transfers.Id, Id));
    for (const Item of Items) {
      await ApplyChange(Tx, CompanyId, Transfer.ToWarehouseId, Item.ProductId, Item.Quantity, "TransferIn", Id);
    }
  });
  return Load(Db, CompanyId, Id);
}

export async function CancelTransfer(CompanyId: number, Id: number) {
  await Db.transaction(async (Tx) => {
    const { Transfer, Items } = await LockTransfer(Tx, CompanyId, Id);
    if (Transfer.Status !== "InTransit" && Transfer.Status !== "Received") throw new AppError(409, "INVALID_STATUS", `Transfer is ${Transfer.Status}`);
    if (Transfer.Status === "Received") {
      for (const Item of Items) {
        await ApplyChange(Tx, CompanyId, Transfer.ToWarehouseId, Item.ProductId, -Item.Quantity, "TransferCancel", Id);
      }
    }
    for (const Item of Items) {
      await ApplyChange(Tx, CompanyId, Transfer.FromWarehouseId, Item.ProductId, Item.Quantity, "TransferCancel", Id);
    }
    await Tx.update(Transfers).set({ Status: "Cancelled", CancelledAt: Now() }).where(eq(Transfers.Id, Id));
  });
  return Load(Db, CompanyId, Id);
}

export async function InTransitByProduct(CompanyId: number, ProductIds: number[]) {
  if (!ProductIds.length) return [];
  return Db.select({ ProductId: TransferItems.ProductId, WarehouseId: Transfers.ToWarehouseId, Quantity: TransferItems.Quantity })
    .from(TransferItems)
    .innerJoin(Transfers, eq(Transfers.Id, TransferItems.TransferId))
    .where(and(eq(Transfers.CompanyId, CompanyId), eq(Transfers.Status, "InTransit"), inArray(TransferItems.ProductId, ProductIds)));
}
