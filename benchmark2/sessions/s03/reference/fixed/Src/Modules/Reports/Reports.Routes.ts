import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { OverdueInstallments } from "../Installments/Installments.Service";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/OverdueInstallments", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  return Ok(C, await OverdueInstallments(C.get("Auth").CompanyId, Query.Page, Query.PageSize));
});
