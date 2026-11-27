import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseId, ParseQuery } from "../../Lib/Validate";
import { AttendanceQuery } from "./Attendance.Schema";
import * as AttendanceService from "./Attendance.Service";

export const AttendanceRoutes = new Hono<AppEnv>();
AttendanceRoutes.use("*", RequireAuth);

AttendanceRoutes.post("/CheckIn", async (C) => Ok(C, await AttendanceService.CheckIn(C.get("Auth").CompanyId, C.get("Auth").UserId), 201));

AttendanceRoutes.post("/CheckOut", async (C) => Ok(C, await AttendanceService.CheckOut(C.get("Auth").CompanyId, C.get("Auth").UserId)));

AttendanceRoutes.get("/", RequireRole("Owner", "Admin"), async (C) => {
  const Query = ParseQuery(C, AttendanceQuery);
  return Ok(C, await AttendanceService.ListAttendance(C.get("Auth").CompanyId, ParseId(Query.UserId), Query.Month));
});
