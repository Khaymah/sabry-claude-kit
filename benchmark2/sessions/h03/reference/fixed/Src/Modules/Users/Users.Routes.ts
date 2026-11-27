import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ChangePasswordBody, CreateUserBody, TransferBody } from "./Users.Schema";
import * as UsersService from "./Users.Service";

export const UsersRoutes = new Hono<AppEnv>();
UsersRoutes.use("*", RequireAuth);

const CanManageStaff = RequireRole("Owner", "Admin", "BranchManager");
const CompanyWide = RequireRole("Owner", "Admin");

UsersRoutes.get("/", async (C) => Ok(C, await UsersService.ListUsers(C.get("Auth"))));

UsersRoutes.post("/", CanManageStaff, async (C) => {
  const Body = await ParseBody(C, CreateUserBody);
  return Ok(C, await UsersService.CreateUser(C.get("Auth"), Body), 201);
});

UsersRoutes.post("/Me/Password", async (C) => {
  const Body = await ParseBody(C, ChangePasswordBody);
  await UsersService.ChangePassword(C.get("Auth").UserId, Body.CurrentPassword, Body.NewPassword);
  return Ok(C, { Changed: true });
});

UsersRoutes.post("/:Id/Deactivate", CanManageStaff, async (C) =>
  Ok(C, await UsersService.SetActive(C.get("Auth"), ParseId(C.req.param("Id")), false)),
);

UsersRoutes.post("/:Id/Activate", CanManageStaff, async (C) =>
  Ok(C, await UsersService.SetActive(C.get("Auth"), ParseId(C.req.param("Id")), true)),
);

UsersRoutes.post("/:Id/Transfer", CompanyWide, async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, TransferBody);
  return Ok(C, await UsersService.TransferUser(C.get("Auth"), Id, Body.BranchId));
});

UsersRoutes.get("/:Id/Transfers", CompanyWide, async (C) =>
  Ok(C, await UsersService.ListTransfers(C.get("Auth"), ParseId(C.req.param("Id")))),
);
