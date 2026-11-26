import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { CreateOrderBody } from "./Orders.Schema";
import * as OrdersService from "./Orders.Service";
import * as InstallmentsService from "../Installments/Installments.Service";
import { z } from "zod";

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

const PlanBody = z.object({ Count: z.number().int().min(2).max(12) });

OrdersRoutes.get("/:Id/InstallmentPlan", async (C) => Ok(C, await InstallmentsService.GetPlan(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

OrdersRoutes.post("/:Id/InstallmentPlan", async (C) => {
  const Body = await ParseBody(C, PlanBody);
  return Ok(C, await InstallmentsService.CreatePlan(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body.Count), 201);
});

OrdersRoutes.put("/:Id/InstallmentPlan", async (C) => {
  const Body = await ParseBody(C, PlanBody);
  return Ok(C, await InstallmentsService.Replan(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body.Count));
});

OrdersRoutes.post("/:Id/Installments/:No/Pay", async (C) => {
  const Body = await ParseBody(C, z.object({ Method: z.enum(["Cash", "Card", "Wallet"]) }));
  return Ok(C, await InstallmentsService.PayInstallment(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), ParseId(C.req.param("No")), Body.Method), 201);
});
