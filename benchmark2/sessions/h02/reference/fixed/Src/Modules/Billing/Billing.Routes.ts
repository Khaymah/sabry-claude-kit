import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { AppError, Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import * as S from "./Billing.Schema";
import * as Billing from "./Billing.Service";

export function ParseKey(Value: string | undefined) {
  const Id = ParseId(Value);
  if (Id > 2147483647) throw new AppError(404, "NOT_FOUND", "Not found");
  return Id;
}

export const PlansRoutes = new Hono<AppEnv>();
PlansRoutes.use("*", RequireAuth);
PlansRoutes.get("/", async (C) => Ok(C, await Billing.ListPlans(C.get("Auth").CompanyId)));
PlansRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, S.CreatePlanBody);
  return Ok(C, await Billing.CreatePlan(C.get("Auth").CompanyId, Body), 201);
});

export const SubscriptionsRoutes = new Hono<AppEnv>();
SubscriptionsRoutes.use("*", RequireAuth);
SubscriptionsRoutes.get("/:Id", async (C) => Ok(C, await Billing.GetSubscription(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")))));
SubscriptionsRoutes.get("/:Id/Invoices", async (C) => Ok(C, await Billing.ListInvoices(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")))));
SubscriptionsRoutes.post("/:Id/ChangePlan", async (C) => {
  const Body = await ParseBody(C, S.ChangePlanBody);
  return Ok(C, await Billing.ChangePlan(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")), Body.PlanId), 201);
});

export const InvoicesRoutes = new Hono<AppEnv>();
InvoicesRoutes.use("*", RequireAuth);
InvoicesRoutes.get("/:Id", async (C) => Ok(C, await Billing.GetInvoice(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")))));
InvoicesRoutes.post("/:Id/Pay", async (C) => {
  const Body = await ParseBody(C, S.PayBody);
  return Ok(C, await Billing.PayInvoice(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")), Body.Method), 201);
});
InvoicesRoutes.post("/:Id/ApplyCoupon", async (C) => {
  const Body = await ParseBody(C, S.ApplyCouponBody);
  return Ok(C, await Billing.ApplyCoupon(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")), Body.Code));
});
InvoicesRoutes.post("/:Id/Refunds", async (C) => {
  const Body = await ParseBody(C, S.RefundBody);
  return Ok(C, await Billing.RefundInvoice(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")), Body.Amount, Body.Reason), 201);
});
InvoicesRoutes.post("/:Id/Split", async (C) => {
  const Body = await ParseBody(C, S.SplitBody);
  return Ok(C, await Billing.SplitInvoice(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")), Body.Parts), 201);
});

export const CouponsRoutes = new Hono<AppEnv>();
CouponsRoutes.use("*", RequireAuth);
CouponsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, S.CreateCouponBody);
  return Ok(C, await Billing.CreateCoupon(C.get("Auth").CompanyId, Body), 201);
});

export const BillingRoutes = new Hono<AppEnv>();
BillingRoutes.use("*", RequireAuth);
BillingRoutes.post("/Run", async (C) => Ok(C, await Billing.RunBilling(C.get("Auth").CompanyId)));
