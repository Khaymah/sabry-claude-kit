import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseQuery } from "../../Lib/Validate";
import { AttendanceFilter, EmployeeBody, LeaveBody, MonthOnly, PageFilter, ParseKey } from "./Hr.Schema";
import * as Hr from "./Hr.Service";
import * as Payroll from "./Hr.Payroll";

const Managers = RequireRole("Owner", "Admin");

export const EmployeesRouter = new Hono<AppEnv>();
EmployeesRouter.use("*", RequireAuth);
EmployeesRouter.get("/", async (C) => Ok(C, await Hr.ListEmployees(C.get("Auth").CompanyId)));
EmployeesRouter.put("/:UserId", Managers, async (C) => {
  const UserId = ParseKey(C.req.param("UserId"));
  return Ok(C, await Hr.SaveEmployee(C.get("Auth").CompanyId, UserId, await ParseBody(C, EmployeeBody)));
});
EmployeesRouter.post("/:UserId/Leaves", Managers, async (C) => {
  const UserId = ParseKey(C.req.param("UserId"));
  return Ok(C, await Hr.RequestLeave(C.get("Auth").CompanyId, UserId, await ParseBody(C, LeaveBody)));
});
EmployeesRouter.get("/:UserId/LeaveBalance", async (C) => Ok(C, await Hr.LeaveBalance(C.get("Auth").CompanyId, ParseKey(C.req.param("UserId")))));

export const AttendanceRouter = new Hono<AppEnv>();
AttendanceRouter.use("*", RequireAuth);
AttendanceRouter.post("/CheckIn", async (C) => Ok(C, await Hr.PunchIn(C.get("Auth").CompanyId, C.get("Auth").UserId)));
AttendanceRouter.post("/CheckOut", async (C) => Ok(C, await Hr.PunchOut(C.get("Auth").CompanyId, C.get("Auth").UserId)));
AttendanceRouter.get("/", Managers, async (C) => {
  const Query = ParseQuery(C, AttendanceFilter);
  return Ok(C, await Hr.MonthPunches(C.get("Auth").CompanyId, ParseKey(Query.UserId), Query.Month));
});

export const LeavesRouter = new Hono<AppEnv>();
LeavesRouter.use("*", RequireAuth);
LeavesRouter.post("/:Id/Cancel", Managers, async (C) => Ok(C, await Hr.CancelLeave(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")))));

export const PayrollRouter = new Hono<AppEnv>();
PayrollRouter.use("*", RequireAuth);
PayrollRouter.post("/Runs", Managers, async (C) => Ok(C, await Payroll.PayMonth(C.get("Auth").CompanyId, (await ParseBody(C, MonthOnly)).Month)));
PayrollRouter.post("/Runs/:Id/Void", RequireRole("Owner"), async (C) => Ok(C, await Payroll.VoidPayroll(C.get("Auth").CompanyId, ParseKey(C.req.param("Id")))));
PayrollRouter.get("/Payslips/Me", async (C) => Ok(C, await Payroll.OwnPayslip(C.get("Auth").CompanyId, C.get("Auth").UserId, ParseQuery(C, MonthOnly).Month)));
PayrollRouter.get("/Payslips", Managers, async (C) => {
  const Query = ParseQuery(C, PageFilter);
  return Ok(C, await Payroll.PayslipList(C.get("Auth").CompanyId, Query.Month, Query.Page, Query.PageSize));
});
