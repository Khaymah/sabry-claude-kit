import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateOrderBody } from "./Orders.Schema";
import * as OrdersService from "./Orders.Service";
import { CheckoutBody } from "../Checkout/Checkout.Schema";
import { Checkout } from "../Checkout/Checkout.Service";

export const OrdersRoutes = new Hono<AppEnv>();
OrdersRoutes.use("*", RequireAuth);

OrdersRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await OrdersService.ListOrders(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

OrdersRoutes.get("/:Id", async (C) =>
  Ok(C, await OrdersService.GetOrder(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

OrdersRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateOrderBody);
  return Ok(C, await OrdersService.CreateOrder(C.get("Auth").CompanyId, Body), 201);
});

OrdersRoutes.post("/:Id/Cancel", async (C) =>
  Ok(C, await OrdersService.CancelOrder(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

OrdersRoutes.post("/:Id/Checkout", async (C) => {
  const Body = await ParseBody(C, CheckoutBody);
  return Ok(C, await Checkout(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body.CardToken));
});
