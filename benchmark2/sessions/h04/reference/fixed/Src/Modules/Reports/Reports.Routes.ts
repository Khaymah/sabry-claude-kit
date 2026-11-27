import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { AgingQuery } from "../Credit/Credit.Schema";
import { CreditAging, OverdueCredit } from "../Credit/Credit.Service";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/OverdueCredit", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await OverdueCredit(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});

ReportsRoutes.get("/CreditAging", async (C) => {
  const Query = ParseQuery(C, AgingQuery);
  return Ok(C, await CreditAging(C.get("Auth").CompanyId, Query.Month));
});
