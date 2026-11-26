import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateOrderBody } from "./Orders.Schema";
import * as OrdersService from "./Orders.Service";
import { WriteOffBody } from "../Credit/Credit.Schema";
import * as CreditService from "../Credit/Credit.Service";

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

OrdersRoutes.post("/:Id/ChargeToCredit", async (C) =>
  Ok(C, await CreditService.ChargeToCredit(C.get("Auth").CompanyId, ParseId(C.req.param("Id"))), 201),
);

OrdersRoutes.post("/:Id/WriteOff", async (C) => {
  const Auth = C.get("Auth");
  const Id = ParseId(C.req.param("Id"));
  await ParseBody(C, WriteOffBody);
  return Ok(C, await CreditService.WriteOff(Auth.CompanyId, Auth.Role, Id));
});
