import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { AssignStaffBody, CreateOrganizerBody, PayoutQuery } from "./Organizers.Schema";
import * as OrganizersService from "./Organizers.Service";

export const OrganizersRoutes = new Hono<AppEnv>();
OrganizersRoutes.use("*", RequireAuth);

OrganizersRoutes.get("/", async (C) => Ok(C, await OrganizersService.ListOrganizers(await OrganizersService.ResolveAccess(C.get("Auth")))));

OrganizersRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, CreateOrganizerBody);
  return Ok(C, await OrganizersService.CreateOrganizer(C.get("Auth").CompanyId, Body.Name), 201);
});

OrganizersRoutes.post("/:Id/Staff", RequireRole("Owner", "Admin"), async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, AssignStaffBody);
  return Ok(C, await OrganizersService.AssignStaff(await OrganizersService.ResolveAccess(C.get("Auth")), Id, Body.UserId), 201);
});

OrganizersRoutes.delete("/:Id/Staff/:UserId", RequireRole("Owner", "Admin"), async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const UserId = ParseId(C.req.param("UserId"));
  return Ok(C, await OrganizersService.RemoveStaff(await OrganizersService.ResolveAccess(C.get("Auth")), Id, UserId));
});

OrganizersRoutes.get("/:Id/Payout", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Query = ParseQuery(C, PayoutQuery);
  return Ok(C, await OrganizersService.Payout(await OrganizersService.ResolveAccess(C.get("Auth")), Id, Query.From, Query.To));
});
