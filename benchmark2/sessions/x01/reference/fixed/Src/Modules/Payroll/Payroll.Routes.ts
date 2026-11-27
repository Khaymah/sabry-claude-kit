import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { MonthQuery, PayslipsQuery, RunBody } from "./Payroll.Schema";
import * as PayrollService from "./Payroll.Service";

export const PayrollRoutes = new Hono<AppEnv>();
PayrollRoutes.use("*", RequireAuth);

PayrollRoutes.post("/Runs", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, RunBody);
  return Ok(C, await PayrollService.RunPayroll(C.get("Auth").CompanyId, Body.Month), 201);
});

PayrollRoutes.post("/Runs/:Id/Void", RequireRole("Owner"), async (C) =>
  Ok(C, await PayrollService.VoidRun(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

PayrollRoutes.get("/Payslips/Me", async (C) => {
  const Query = ParseQuery(C, MonthQuery);
  return Ok(C, await PayrollService.MyPayslip(C.get("Auth").CompanyId, C.get("Auth").UserId, Query.Month));
});

PayrollRoutes.get("/Payslips", RequireRole("Owner", "Admin"), async (C) => {
  const Query = ParseQuery(C, PayslipsQuery);
  return Ok(C, await PayrollService.ListPayslips(C.get("Auth").CompanyId, Query.Month, Query.Page, Query.PageSize));
});
