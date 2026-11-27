import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateOrderBody, PayOrderBody } from "./Orders.Schema";
import * as OrdersService from "./Orders.Service";

export const OrdersRoutes = new Hono<AppEnv>();
OrdersRoutes.use("*", RequireAuth);

OrdersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await OrdersService.ListOrders(C.get("Auth"), Query.Page, Query.PageSize));
});

OrdersRoutes.get("/:Id", async (C) => Ok(C, await OrdersService.GetOrder(C.get("Auth"), ParseId(C.req.param("Id")))));

OrdersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateOrderBody);
  return Ok(C, await OrdersService.CreateOrder(C.get("Auth"), Body), 201);
});

OrdersRoutes.post("/:Id/Cancel", RequireRole("Owner", "Admin", "BranchManager", "Staff"), async (C) =>
  Ok(C, await OrdersService.CancelOrder(C.get("Auth"), ParseId(C.req.param("Id")))),
);

OrdersRoutes.post("/:Id/Pay", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, PayOrderBody);
  return Ok(C, await OrdersService.PayOrder(C.get("Auth"), Id, Body.Method), 201);
});
