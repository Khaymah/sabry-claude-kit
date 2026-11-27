import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { AppError, Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import * as Subs from "./Subscriptions.Service";
import { ReadInvoice, SubscriptionInvoices } from "../Invoices/Invoices.Service";

export const RowId = z.number().int().positive().max(2147483647);

export function PathId(Value: string | undefined) {
  const Parsed = z.coerce.number().int().positive().max(2147483647).safeParse(Value);
  if (!Parsed.success) throw new AppError(404, "NOT_FOUND", "Not found");
  return Parsed.data;
}

export const SubscribeBody = z.object({ PlanId: RowId });

export const PlansRoutes = new Hono<AppEnv>();
PlansRoutes.use("*", RequireAuth);
PlansRoutes.get("/", async (C) => Ok(C, await Subs.ListPlans(C.get("Auth").CompanyId)));
PlansRoutes.post("/", async (C) => {
  const Body = await ParseBody(
    C,
    z.object({ Name: z.string().trim().min(1).max(120), Price: z.number().int().min(1).max(2_000_000_000), IntervalMonths: z.literal([1, 3, 12]) }),
  );
  return Ok(C, await Subs.CreatePlan(C.get("Auth").CompanyId, Body.Name, Body.Price, Body.IntervalMonths), 201);
});

export const SubscriptionsRoutes = new Hono<AppEnv>();
SubscriptionsRoutes.use("*", RequireAuth);
SubscriptionsRoutes.get("/:Id", async (C) => Ok(C, await Subs.GetSubscription(C.get("Auth").CompanyId, PathId(C.req.param("Id")))));
SubscriptionsRoutes.get("/:Id/Invoices", async (C) => Ok(C, await SubscriptionInvoices(C.get("Auth").CompanyId, PathId(C.req.param("Id")))));
SubscriptionsRoutes.post("/:Id/ChangePlan", async (C) => {
  const Body = await ParseBody(C, SubscribeBody);
  const CompanyId = C.get("Auth").CompanyId;
  const Result = await Subs.ChangePlan(CompanyId, PathId(C.req.param("Id")), Body.PlanId);
  return Ok(C, { Subscription: Result.Subscription, Invoice: await ReadInvoice(CompanyId, Result.InvoiceId) });
});

export const BillingRoutes = new Hono<AppEnv>();
BillingRoutes.use("*", RequireAuth);
BillingRoutes.post("/Run", async (C) => Ok(C, await Subs.RunBilling(C.get("Auth").CompanyId)));
