import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CreateGroupBody, UpdateGroupBody } from "./CustomerGroups.Schema";
import * as GroupsService from "./CustomerGroups.Service";

export const CustomerGroupsRoutes = new Hono<AppEnv>();
CustomerGroupsRoutes.use("*", RequireAuth);

CustomerGroupsRoutes.get("/", async (C) => Ok(C, await GroupsService.ListGroups(C.get("Auth").CompanyId)));

CustomerGroupsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateGroupBody);
  return Ok(C, await GroupsService.CreateGroup(C.get("Auth").CompanyId, Body), 201);
});

CustomerGroupsRoutes.patch("/:Id", async (C) => {
  const Body = await ParseBody(C, UpdateGroupBody);
  return Ok(C, await GroupsService.UpdateGroup(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body));
});
