import { sql, type SQL } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import type { TransferLine } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";

type Executor = Transaction | typeof Db;
type Delta = { StoreId: number; ProductId: number; Delta: number };
type TransferRow = { Id: number; FromStoreId: number; ToStoreId: number; State: string; Lines: TransferLine[] };

export async function Rows<T>(Ex: Executor, Query: SQL): Promise<T[]> {
  const Result = (await Ex.execute(Query)) as unknown as { rows: T[] };
  return Result.rows;
}

const Missing = (What: string) => new AppError(404, "NOT_FOUND", `${What} not found`);

async function LockStores(Tx: Transaction, CompanyId: number, Ids: number[]) {
  const Wanted = [...new Set(Ids)].sort((A, B) => A - B);
  const Found = await Rows<{ Id: number }>(
    Tx,
    sql`SELECT "Id" FROM "Stores" WHERE "CompanyId" = ${CompanyId} AND "Id" IN (${sql.join(Wanted.map((I) => sql`${I}`), sql`, `)}) ORDER BY "Id" FOR UPDATE`,
  );
  if (Found.length !== Wanted.length) throw Missing("Warehouse");
}

async function CheckProducts(Ex: Executor, CompanyId: number, Ids: number[]) {
  const Wanted = [...new Set(Ids)];
  const Found = await Rows<{ N: number }>(
    Ex,
    sql`SELECT count(*)::int AS "N" FROM "Products" WHERE "CompanyId" = ${CompanyId} AND "Id" IN (${sql.join(Wanted.map((I) => sql`${I}`), sql`, `)})`,
  );
  if (Found[0].N !== Wanted.length) throw Missing("Product");
}

async function OnHand(Ex: Executor, StoreId: number, ProductIds: number[]) {
  const Result = await Rows<{ ProductId: number; Qty: number }>(
    Ex,
    sql`SELECT "ProductId", sum("Delta")::int AS "Qty" FROM "StockLedger" WHERE "StoreId" = ${StoreId} AND "ProductId" IN (${sql.join(ProductIds.map((I) => sql`${I}`), sql`, `)}) GROUP BY "ProductId"`,
  );
  return new Map(Result.map((R) => [R.ProductId, R.Qty]));
}

async function Book(Tx: Transaction, CompanyId: number, Kind: string, Deltas: Delta[], TransferId: number | null = null, Note: string | null = null) {
  for (const D of Deltas.filter((X) => X.Delta < 0)) {
    const Have = (await OnHand(Tx, D.StoreId, [D.ProductId])).get(D.ProductId) ?? 0;
    if (Have + D.Delta < 0) throw new AppError(409, "NOT_ENOUGH_STOCK", `Only ${Have} of product ${D.ProductId} available`);
  }
  for (const D of Deltas) {
    await Tx.execute(
      sql`INSERT INTO "StockLedger" ("CompanyId", "StoreId", "ProductId", "Delta", "Kind", "TransferId", "Note") VALUES (${CompanyId}, ${D.StoreId}, ${D.ProductId}, ${D.Delta}, ${Kind}, ${TransferId}, ${Note})`,
    );
  }
}

export async function ListStores(CompanyId: number) {
  const Items = await Rows(Db, sql`SELECT "Id", "Name", "Kind" FROM "Stores" WHERE "CompanyId" = ${CompanyId} ORDER BY "Id"`);
  return { Items };
}

export async function CreateStore(CompanyId: number, Name: string) {
  const [Store] = await Rows(Db, sql`INSERT INTO "Stores" ("CompanyId", "Name") VALUES (${CompanyId}, ${Name}) RETURNING "Id", "Name", "Kind"`);
  return Store;
}

async function OwnStore(Ex: Executor, CompanyId: number, StoreId: number) {
  const Found = await Rows(Ex, sql`SELECT 1 FROM "Stores" WHERE "Id" = ${StoreId} AND "CompanyId" = ${CompanyId}`);
  if (!Found.length) throw Missing("Warehouse");
}

export async function StoreStock(CompanyId: number, StoreId: number) {
  await OwnStore(Db, CompanyId, StoreId);
  const Items = await Rows(
    Db,
    sql`SELECT "ProductId", sum("Delta")::int AS "Quantity" FROM "StockLedger" WHERE "StoreId" = ${StoreId} GROUP BY "ProductId" HAVING sum("Delta") <> 0 ORDER BY "ProductId"`,
  );
  return { Items };
}

export async function AdjustStock(CompanyId: number, StoreId: number, ProductId: number, Change: number, Reason?: string) {
  return Db.transaction(async (Tx) => {
    await LockStores(Tx, CompanyId, [StoreId]);
    await CheckProducts(Tx, CompanyId, [ProductId]);
    await Book(Tx, CompanyId, "Adjustment", [{ StoreId, ProductId, Delta: Change }], null, Reason ?? null);
    const Quantity = (await OnHand(Tx, StoreId, [ProductId])).get(ProductId) ?? 0;
    return { ProductId, Quantity };
  });
}

export async function CountStock(CompanyId: number, StoreId: number, Lines: { ProductId: number; Counted: number }[]) {
  if (new Set(Lines.map((L) => L.ProductId)).size !== Lines.length) throw new AppError(409, "DUPLICATE_LINE", "A product is counted twice");
  return Db.transaction(async (Tx) => {
    await LockStores(Tx, CompanyId, [StoreId]);
    const Ids = Lines.map((L) => L.ProductId);
    await CheckProducts(Tx, CompanyId, Ids);
    const Have = await OnHand(Tx, StoreId, Ids);
    const Out = Lines.map((L) => ({ ProductId: L.ProductId, Before: Have.get(L.ProductId) ?? 0, Counted: L.Counted, Difference: L.Counted - (Have.get(L.ProductId) ?? 0) }));
    const Moves = Out.filter((L) => L.Difference !== 0);
    if (Moves.length) {
      await Tx.execute(
        sql`INSERT INTO "StockLedger" ("CompanyId", "StoreId", "ProductId", "Delta", "Kind") VALUES ${sql.join(
          Moves.map((M) => sql`(${CompanyId}, ${StoreId}, ${M.ProductId}, ${M.Difference}, 'Stocktake')`),
          sql`, `,
        )}`,
      );
    }
    return { Lines: Out };
  });
}

export async function Ledger(CompanyId: number, StoreId: number, ProductId: number) {
  await OwnStore(Db, CompanyId, StoreId);
  const Items = await Rows(
    Db,
    sql`SELECT L."Id", L."ProductId", L."Delta" AS "Change", L."Kind" AS "Type", (sum(L."Delta") OVER (ORDER BY L."Id"))::int AS "Balance", L."TransferId", L."Note", L."CreatedAt"
        FROM "StockLedger" L JOIN "Products" P ON P."Id" = L."ProductId" AND P."CompanyId" = ${CompanyId}
        WHERE L."StoreId" = ${StoreId} AND L."ProductId" = ${ProductId} ORDER BY L."Id"`,
  );
  return { Items };
}

function Present(T: TransferRow) {
  return { Id: T.Id, Status: T.State, FromWarehouseId: T.FromStoreId, ToWarehouseId: T.ToStoreId, Items: T.Lines };
}

async function LoadTransfer(Ex: Executor, CompanyId: number, Id: number, Lock = false) {
  const [T] = await Rows<TransferRow>(
    Ex,
    sql`SELECT "Id", "FromStoreId", "ToStoreId", "State", "Lines" FROM "StockTransfers" WHERE "Id" = ${Id} AND "CompanyId" = ${CompanyId} ${Lock ? sql`FOR UPDATE` : sql``}`,
  );
  if (!T) throw Missing("Transfer");
  return T;
}

export async function ShowTransfer(CompanyId: number, Id: number) {
  return Present(await LoadTransfer(Db, CompanyId, Id));
}

export async function StartTransfer(CompanyId: number, From: number, To: number, Lines: TransferLine[]) {
  return Db.transaction(async (Tx) => {
    await LockStores(Tx, CompanyId, [From, To]);
    await CheckProducts(Tx, CompanyId, Lines.map((L) => L.ProductId));
    const [T] = await Rows<TransferRow>(
      Tx,
      sql`INSERT INTO "StockTransfers" ("CompanyId", "FromStoreId", "ToStoreId", "Lines") VALUES (${CompanyId}, ${From}, ${To}, ${JSON.stringify(Lines)}::jsonb) RETURNING "Id", "FromStoreId", "ToStoreId", "State", "Lines"`,
    );
    await Book(Tx, CompanyId, "TransferOut", Lines.map((L) => ({ StoreId: From, ProductId: L.ProductId, Delta: -L.Quantity })), T.Id);
    return Present(T);
  });
}

async function Move(CompanyId: number, Id: number, Allowed: string[], Next: string, Effects: (T: TransferRow) => { Kind: string; Deltas: Delta[] }[]) {
  return Db.transaction(async (Tx) => {
    const T = await LoadTransfer(Tx, CompanyId, Id, true);
    if (!Allowed.includes(T.State)) throw new AppError(409, "INVALID_STATE", `Transfer is ${T.State}`);
    await LockStores(Tx, CompanyId, [T.FromStoreId, T.ToStoreId]);
    for (const E of Effects(T)) await Book(Tx, CompanyId, E.Kind, E.Deltas, Id);
    const [Done] = await Rows<TransferRow>(
      Tx,
      sql`UPDATE "StockTransfers" SET "State" = ${Next}, "ClosedAt" = ${Now().toISOString()} WHERE "Id" = ${Id} AND "State" = ${T.State} RETURNING "Id", "FromStoreId", "ToStoreId", "State", "Lines"`,
    );
    if (!Done) throw new AppError(409, "INVALID_STATE", "Transfer changed meanwhile");
    return Present(Done);
  });
}

export function ReceiveTransfer(CompanyId: number, Id: number) {
  return Move(CompanyId, Id, ["InTransit"], "Received", (T) => [
    { Kind: "TransferIn", Deltas: T.Lines.map((L) => ({ StoreId: T.ToStoreId, ProductId: L.ProductId, Delta: L.Quantity })) },
  ]);
}

export function CancelTransfer(CompanyId: number, Id: number) {
  return Move(CompanyId, Id, ["InTransit", "Received"], "Cancelled", (T) => {
    const Back = { Kind: "TransferCancel", Deltas: T.Lines.map((L) => ({ StoreId: T.FromStoreId, ProductId: L.ProductId, Delta: L.Quantity })) };
    if (T.State !== "Received") return [Back];
    return [{ Kind: "TransferCancel", Deltas: T.Lines.map((L) => ({ StoreId: T.ToStoreId, ProductId: L.ProductId, Delta: -L.Quantity })) }, Back];
  });
}
