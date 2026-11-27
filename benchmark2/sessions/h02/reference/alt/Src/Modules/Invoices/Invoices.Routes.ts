import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { PathId } from "../Subscriptions/Subscriptions.Routes";
import * as Inv from "./Invoices.Service";

export const InvoicesRoutes = new Hono<AppEnv>();
InvoicesRoutes.use("*", RequireAuth);
InvoicesRoutes.get("/:Id", async (C) => Ok(C, await Inv.ReadInvoice(C.get("Auth").CompanyId, PathId(C.req.param("Id")))));
InvoicesRoutes.post("/:Id/Pay", async (C) => {
  const Body = await ParseBody(C, z.object({ Method: z.enum(["Cash", "Card"]) }));
  return Ok(C, await Inv.Settle(C.get("Auth").CompanyId, PathId(C.req.param("Id")), Body.Method), 201);
});
InvoicesRoutes.post("/:Id/ApplyCoupon", async (C) => {
  const Body = await ParseBody(C, z.object({ Code: z.string().min(1).max(64) }));
  return Ok(C, await Inv.Redeem(C.get("Auth").CompanyId, PathId(C.req.param("Id")), Body.Code), 201);
});
InvoicesRoutes.post("/:Id/Refunds", async (C) => {
  const Body = await ParseBody(C, z.object({ Amount: z.number().int().min(1).max(2_000_000_000), Reason: z.string().max(500).optional() }));
  return Ok(C, await Inv.GiveBack(C.get("Auth").CompanyId, PathId(C.req.param("Id")), Body.Amount, Body.Reason), 201);
});
InvoicesRoutes.post("/:Id/Split", async (C) => {
  const Body = await ParseBody(C, z.object({ Parts: z.number().int().min(2).max(6) }));
  return Ok(C, await Inv.Divide(C.get("Auth").CompanyId, PathId(C.req.param("Id")), Body.Parts));
});

export const CouponsRoutes = new Hono<AppEnv>();
CouponsRoutes.use("*", RequireAuth);
CouponsRoutes.post("/", async (C) => {
  const Body = await ParseBody(
    C,
    z.object({ Code: z.string().trim().min(1).max(64), PercentOff: z.number().int().min(1).max(100), MaxRedemptions: z.number().int().min(1).max(1_000_000) }),
  );
  return Ok(C, await Inv.NewCoupon(C.get("Auth").CompanyId, Body.Code, Body.PercentOff, Body.MaxRedemptions), 201);
});
