import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CloseBranchBody, CreateBranchBody } from "./Branches.Schema";
import * as BranchesService from "./Branches.Service";

export const BranchesRoutes = new Hono<AppEnv>();
BranchesRoutes.use("*", RequireAuth);

BranchesRoutes.get("/", async (C) => Ok(C, await BranchesService.ListBranches(C.get("Auth").CompanyId)));

BranchesRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, CreateBranchBody);
  return Ok(C, await BranchesService.CreateBranch(C.get("Auth"), Body.Name), 201);
});

BranchesRoutes.post("/:Id/Close", RequireRole("Owner"), async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, CloseBranchBody);
  return Ok(C, await BranchesService.CloseBranch(C.get("Auth"), Id, Body.MoveStaffTo));
});
