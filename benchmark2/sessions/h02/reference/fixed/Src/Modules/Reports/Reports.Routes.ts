import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { DailyRevenueQuery } from "../Billing/Billing.Schema";
import { DailyRevenue } from "../Billing/Billing.Service";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);
ReportsRoutes.get("/DailyRevenue", async (C) => {
  const Query = ParseQuery(C, DailyRevenueQuery);
  return Ok(C, await DailyRevenue(C.get("Auth").CompanyId, Query.Date));
});
