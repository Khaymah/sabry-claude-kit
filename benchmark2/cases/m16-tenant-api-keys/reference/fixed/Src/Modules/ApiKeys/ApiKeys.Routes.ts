import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { CreateApiKeyBody } from "./ApiKeys.Schema";
import * as ApiKeysService from "./ApiKeys.Service";

export const ApiKeysRoutes = new Hono<AppEnv>();
ApiKeysRoutes.use("*", RequireAuth, RequireRole("Owner"));

ApiKeysRoutes.get("/", async (C) => Ok(C, await ApiKeysService.ListApiKeys(C.get("Auth").CompanyId)));

ApiKeysRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateApiKeyBody);
  return Ok(C, await ApiKeysService.CreateApiKey(C.get("Auth").CompanyId, Body.Name), 201);
});

ApiKeysRoutes.delete("/:Id", async (C) =>
  Ok(C, await ApiKeysService.RevokeApiKey(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);
