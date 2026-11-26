import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { IdQuery, ParseQuery } from "../../Lib/Validate";
import { BranchesReport } from "./Reports.Service";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

const BranchesQuery = z.object({ From: z.iso.date(), To: z.iso.date(), BranchId: IdQuery.optional() });

ReportsRoutes.get("/Branches", RequireRole("Owner", "Admin", "BranchManager"), async (C) => {
  const Query = ParseQuery(C, BranchesQuery);
  return Ok(C, await BranchesReport(C.get("Auth"), Query.From, Query.To, Query.BranchId));
});
