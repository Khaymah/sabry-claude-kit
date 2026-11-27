import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ChangePasswordBody, CreateUserBody } from "./Users.Schema";
import * as UsersService from "./Users.Service";

export const UsersRoutes = new Hono<AppEnv>();
UsersRoutes.use("*", RequireAuth);

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
