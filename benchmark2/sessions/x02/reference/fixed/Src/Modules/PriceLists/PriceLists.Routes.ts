import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { CreatePriceListBody } from "./PriceLists.Schema";
import * as PriceListsService from "./PriceLists.Service";

export const PriceListsRoutes = new Hono<AppEnv>();
PriceListsRoutes.use("*", RequireAuth);

PriceListsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreatePriceListBody);
  return Ok(C, await PriceListsService.CreatePriceList(C.get("Auth").CompanyId, Body), 201);
});
