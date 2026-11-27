import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { LoginBody, ResetConfirmBody, ResetRequestBody } from "./Auth.Schema";
import * as ResetService from "./PasswordReset.Service";
import * as AuthService from "./Auth.Service";

export const AuthRoutes = new Hono<AppEnv>();

AuthRoutes.post("/Login", async (C) => {
  const Body = await ParseBody(C, LoginBody);
  return Ok(C, await AuthService.Login(Body.Email, Body.Password));
});

AuthRoutes.post("/Logout", RequireAuth, async (C) => {
  await AuthService.Logout(C.get("Auth").SessionId);
  return Ok(C, { LoggedOut: true });
});

AuthRoutes.get("/Me", RequireAuth, async (C) => Ok(C, await AuthService.GetMe(C.get("Auth").UserId)));

AuthRoutes.post("/PasswordReset/Request", async (C) => {
  const Body = await ParseBody(C, ResetRequestBody);
  await ResetService.RequestReset(Body.Email);
  return Ok(C, { Requested: true });
});

AuthRoutes.post("/PasswordReset/Confirm", async (C) => {
  const Body = await ParseBody(C, ResetConfirmBody);
  await ResetService.ConfirmReset(Body.Token, Body.NewPassword);
  return Ok(C, { Reset: true });
});
