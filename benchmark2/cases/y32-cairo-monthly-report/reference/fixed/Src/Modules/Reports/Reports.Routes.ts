import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseQuery } from "../../Lib/Validate";
import { MonthQuery } from "../Expenses/Expenses.Schema";
import * as ReportsService from "./Reports.Service";

export const ReportsRoutes = new Hono<AppEnv>();
ReportsRoutes.use("*", RequireAuth);

ReportsRoutes.get("/Monthly", async (C) => Ok(C, await ReportsService.MonthlySales(C.get("Auth").CompanyId, ParseQuery(C, MonthQuery).Month)));
