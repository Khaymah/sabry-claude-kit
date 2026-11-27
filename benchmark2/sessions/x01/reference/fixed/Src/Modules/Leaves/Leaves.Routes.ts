import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseId } from "../../Lib/Validate";
import * as LeavesService from "./Leaves.Service";

export const LeavesRoutes = new Hono<AppEnv>();
LeavesRoutes.use("*", RequireAuth);

LeavesRoutes.post("/:Id/Cancel", RequireRole("Owner", "Admin"), async (C) =>
  Ok(C, await LeavesService.CancelLeave(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);
