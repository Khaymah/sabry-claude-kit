import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { AdjustmentBody, CreateWarehouseBody, MovementsQuery, StocktakeBody } from "./Warehouses.Schema";
import * as WarehousesService from "./Warehouses.Service";

export const WarehousesRoutes = new Hono<AppEnv>();
WarehousesRoutes.use("*", RequireAuth);

WarehousesRoutes.get("/", async (C) => Ok(C, await WarehousesService.ListWarehouses(C.get("Auth").CompanyId)));

WarehousesRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateWarehouseBody);
  return Ok(C, await WarehousesService.CreateWarehouse(C.get("Auth").CompanyId, Body.Name), 201);
});

WarehousesRoutes.get("/:Id/Stock", async (C) =>
  Ok(C, await WarehousesService.GetStock(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

WarehousesRoutes.post("/:Id/Adjustments", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, AdjustmentBody);
  return Ok(C, await WarehousesService.Adjust(C.get("Auth").CompanyId, Id, Body), 201);
});

WarehousesRoutes.post("/:Id/Stocktakes", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, StocktakeBody);
  return Ok(C, await WarehousesService.Stocktake(C.get("Auth").CompanyId, Id, Body.Lines), 201);
});

WarehousesRoutes.get("/:Id/Movements", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Query = ParseQuery(C, MovementsQuery);
  return Ok(C, await WarehousesService.ListMovements(C.get("Auth").CompanyId, Id, Query.ProductId));
});
