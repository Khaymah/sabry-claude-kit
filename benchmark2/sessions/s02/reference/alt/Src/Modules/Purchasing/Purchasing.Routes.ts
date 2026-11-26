import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { CreatePurchaseOrderBody, ReceiptBody } from "./Purchasing.Schema";
import * as PurchasingService from "./Purchasing.Service";

export const PurchasingRoutes = new Hono<AppEnv>();
PurchasingRoutes.use("*", RequireAuth);

PurchasingRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, z.object({ SupplierId: z.coerce.number().int().positive().optional() }));
  return Ok(C, await PurchasingService.ListPurchaseOrders(C.get("Auth").CompanyId, Query.SupplierId));
});

PurchasingRoutes.get("/:Id", async (C) => Ok(C, await PurchasingService.GetPurchaseOrder(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))));

PurchasingRoutes.post("/:Id/Receipts", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, ReceiptBody);
  const Auth = C.get("Auth");
  return Ok(C, await PurchasingService.ReceiveLines(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id")), Body.Lines));
});

PurchasingRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, CreatePurchaseOrderBody);
  const Auth = C.get("Auth");
  return Ok(C, await PurchasingService.CreatePurchaseOrder(Auth.CompanyId, Auth.UserId, Body), 201);
});

PurchasingRoutes.post("/:Id/Receive", RequireRole("Owner", "Admin"), async (C) => {
  const Auth = C.get("Auth");
  return Ok(C, await PurchasingService.ReceivePurchaseOrder(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id"))));
});
