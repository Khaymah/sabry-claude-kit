import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { AcceptInviteBody, ChangePasswordBody, ChangeRoleBody, CreateUserBody, InviteBody } from "./Users.Schema";
import * as InvitesService from "./Users.Invites";
import * as UsersService from "./Users.Service";

export const UsersRoutes = new Hono<AppEnv>();

UsersRoutes.post("/Invites/Accept", async (C) => {
  const Body = await ParseBody(C, AcceptInviteBody);
  return Ok(C, await InvitesService.AcceptInvite(Body.Token, Body.Name, Body.Password), 201);
});

UsersRoutes.use("*", RequireAuth);

UsersRoutes.post("/Invites", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, InviteBody);
  const Auth = C.get("Auth");
  return Ok(C, await InvitesService.InviteUser(Auth.CompanyId, Auth.UserId, Body.Email, Body.Role), 201);
});

UsersRoutes.patch("/:Id/Role", RequireRole("Owner"), async (C) => {
  const Body = await ParseBody(C, ChangeRoleBody);
  return Ok(C, await InvitesService.ChangeRole(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body.Role));
});

UsersRoutes.get("/", async (C) => Ok(C, await UsersService.ListUsers(C.get("Auth").CompanyId)));

UsersRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, CreateUserBody);
  return Ok(C, await UsersService.CreateUser(C.get("Auth").CompanyId, Body), 201);
});

UsersRoutes.post("/Me/Password", async (C) => {
  const Body = await ParseBody(C, ChangePasswordBody);
  await UsersService.ChangePassword(C.get("Auth").UserId, Body.CurrentPassword, Body.NewPassword);
  return Ok(C, { Changed: true });
});

UsersRoutes.post("/:Id/Deactivate", RequireRole("Owner", "Admin"), async (C) =>
  Ok(C, await UsersService.SetActive(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), false)),
);
