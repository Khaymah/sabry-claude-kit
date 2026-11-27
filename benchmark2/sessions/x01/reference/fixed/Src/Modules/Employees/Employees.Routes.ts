import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CreateLeaveBody, PutEmployeeBody } from "./Employees.Schema";
import * as EmployeesService from "./Employees.Service";
import * as LeavesService from "../Leaves/Leaves.Service";

export const EmployeesRoutes = new Hono<AppEnv>();
EmployeesRoutes.use("*", RequireAuth);

EmployeesRoutes.get("/", async (C) => Ok(C, await EmployeesService.ListEmployees(C.get("Auth").CompanyId)));

EmployeesRoutes.put("/:UserId", RequireRole("Owner", "Admin"), async (C) => {
  const UserId = ParseId(C.req.param("UserId"));
  const Body = await ParseBody(C, PutEmployeeBody);
  return Ok(C, await EmployeesService.PutEmployee(C.get("Auth").CompanyId, UserId, Body));
});

EmployeesRoutes.post("/:UserId/Leaves", RequireRole("Owner", "Admin"), async (C) => {
  const UserId = ParseId(C.req.param("UserId"));
  const Body = await ParseBody(C, CreateLeaveBody);
  return Ok(C, await LeavesService.CreateLeave(C.get("Auth").CompanyId, UserId, Body), 201);
});

EmployeesRoutes.get("/:UserId/LeaveBalance", async (C) =>
  Ok(C, await LeavesService.LeaveBalance(C.get("Auth").CompanyId, ParseId(C.req.param("UserId")))),
);
