import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { LoginBody } from "./Auth.Schema";
import * as AuthService from "./Auth.Service";

export const AuthRoutes = new Hono<AppEnv>();

AuthRoutes.post("/Login", async (C) => {
  const Body = await ParseBody(C, LoginBody);
  return Ok(C, await AuthService.Login(Body.Email, Body.Password));
});

AuthRoutes.post("/Logout", RequireAuth, async (C) => {
  await AuthService.Logout(C.get("Auth").UserId);
  return Ok(C, { LoggedOut: true });
});

AuthRoutes.get("/Me", RequireAuth, async (C) => Ok(C, await AuthService.GetMe(C.get("Auth").UserId)));
