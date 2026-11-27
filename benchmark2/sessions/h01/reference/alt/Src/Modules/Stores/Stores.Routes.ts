import { Hono, type Context } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { AppError, Ok } from "../../Lib/Response";
import { ParseBody, ParseQuery } from "../../Lib/Validate";
import { AdjustBody, CountBody, LedgerQuery, NewStoreBody, TransferBody } from "./Stores.Schema";
import * as Stores from "./Stores.Service";

function PathId(C: Context) {
  const Raw = C.req.param("Id") ?? "";
  if (!/^\d{1,9}$/.test(Raw) || Number(Raw) === 0) throw new AppError(404, "NOT_FOUND", "Not found");
  return Number(Raw);
}

export const StoresRoutes = new Hono<AppEnv>();
StoresRoutes.use("*", RequireAuth);

StoresRoutes.get("/", async (C) => Ok(C, await Stores.ListStores(C.get("Auth").CompanyId)));
StoresRoutes.post("/", async (C) => Ok(C, await Stores.CreateStore(C.get("Auth").CompanyId, (await ParseBody(C, NewStoreBody)).Name)));
StoresRoutes.get("/:Id/Stock", async (C) => Ok(C, await Stores.StoreStock(C.get("Auth").CompanyId, PathId(C))));
StoresRoutes.post("/:Id/Adjustments", async (C) => {
  const Id = PathId(C);
  const Body = await ParseBody(C, AdjustBody);
  return Ok(C, await Stores.AdjustStock(C.get("Auth").CompanyId, Id, Body.ProductId, Body.Change, Body.Reason));
});
StoresRoutes.post("/:Id/Stocktakes", async (C) => {
  const Id = PathId(C);
  const Body = await ParseBody(C, CountBody);
  return Ok(C, await Stores.CountStock(C.get("Auth").CompanyId, Id, Body.Lines));
});
StoresRoutes.get("/:Id/Movements", async (C) => {
  const Id = PathId(C);
  const Query = ParseQuery(C, LedgerQuery);
  return Ok(C, await Stores.Ledger(C.get("Auth").CompanyId, Id, Query.ProductId));
});

export const TransferRoutes = new Hono<AppEnv>();
TransferRoutes.use("*", RequireAuth);

TransferRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, TransferBody);
  return Ok(C, await Stores.StartTransfer(C.get("Auth").CompanyId, Body.FromWarehouseId, Body.ToWarehouseId, Body.Items));
});
TransferRoutes.get("/:Id", async (C) => Ok(C, await Stores.ShowTransfer(C.get("Auth").CompanyId, PathId(C))));
TransferRoutes.post("/:Id/Receive", async (C) => Ok(C, await Stores.ReceiveTransfer(C.get("Auth").CompanyId, PathId(C))));
TransferRoutes.post("/:Id/Cancel", async (C) => Ok(C, await Stores.CancelTransfer(C.get("Auth").CompanyId, PathId(C))));
