import { Hono } from "hono";
import { z } from "zod";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { PageQuery } from "../../Lib/Pagination";
import { MoneyString } from "../Products/Products.Schema";
import * as ShiftsService from "./Shifts.Service";

export const ShiftsRoutes = new Hono<AppEnv>();
ShiftsRoutes.use("*", RequireAuth);

ShiftsRoutes.post("/Open", async (C) => {
  const Body = await ParseBody(C, z.object({ OpeningCash: MoneyString }));
  const Auth = C.get("Auth");
  return Ok(C, await ShiftsService.OpenShift(Auth.CompanyId, Auth.UserId, Body.OpeningCash), 201);
});

ShiftsRoutes.get("/Mine", async (C) => {
  const Query = ParseQuery(C, PageQuery);
  const Auth = C.get("Auth");
  return Ok(C, await ShiftsService.ListShifts(Auth.CompanyId, Query.Page, Query.PageSize, Auth.UserId));
});

ShiftsRoutes.get("/", RequireRole("Owner", "Admin"), async (C) => {
  const Query = ParseQuery(C, PageQuery.extend({ UserId: z.coerce.number().int().positive().optional() }));
  return Ok(C, await ShiftsService.ListShifts(C.get("Auth").CompanyId, Query.Page, Query.PageSize, Query.UserId));
});

ShiftsRoutes.post("/:Id/Close", async (C) => {
  const Body = await ParseBody(C, z.object({ CountedCash: MoneyString }));
  const Auth = C.get("Auth");
  return Ok(C, await ShiftsService.CloseShift(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id")), Body.CountedCash));
});

ShiftsRoutes.post("/:Id/ForceClose", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, z.object({ CountedCash: MoneyString }));
  return Ok(C, await ShiftsService.ForceClose(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body.CountedCash));
});

ShiftsRoutes.post("/:Id/CashOut", async (C) => {
  const Body = await ParseBody(C, z.object({ Amount: MoneyString, Reason: z.string().trim().min(1).max(200) }));
  const Auth = C.get("Auth");
  return Ok(C, await ShiftsService.CashOut(Auth.CompanyId, Auth.UserId, ParseId(C.req.param("Id")), Body.Amount, Body.Reason), 201);
});
