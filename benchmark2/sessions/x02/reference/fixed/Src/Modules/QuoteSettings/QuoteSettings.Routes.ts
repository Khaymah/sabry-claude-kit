import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { SetValidityDays, ValidityDays } from "./QuoteSettings.Service";
import { Db } from "../../Database/Db";

const SettingsBody = z.object({ ValidityDays: z.number().int().min(1).max(365) });

export const QuoteSettingsRoutes = new Hono<AppEnv>();
QuoteSettingsRoutes.use("*", RequireAuth);

QuoteSettingsRoutes.get("/", async (C) => Ok(C, { ValidityDays: await ValidityDays(Db, C.get("Auth").CompanyId) }));

QuoteSettingsRoutes.put("/", RequireRole("Owner"), async (C) => {
  const Body = await ParseBody(C, SettingsBody);
  return Ok(C, await SetValidityDays(C.get("Auth").CompanyId, Body.ValidityDays));
});
