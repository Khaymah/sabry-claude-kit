import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ResolveAccess } from "../Organizers/Organizers.Service";
import { PurchaseFromHold } from "../Purchases/Purchases.Service";
import { CreateHoldBody, PurchaseHoldBody } from "./Holds.Schema";
import * as HoldsService from "./Holds.Service";

export const HoldsRoutes = new Hono<AppEnv>();
HoldsRoutes.use("*", RequireAuth);

HoldsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateHoldBody);
  return Ok(C, await HoldsService.CreateHold(await ResolveAccess(C.get("Auth")), Body), 201);
});

HoldsRoutes.get("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await HoldsService.GetHold(await ResolveAccess(C.get("Auth")), Id));
});

HoldsRoutes.post("/:Id/Release", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await HoldsService.ReleaseHold(await ResolveAccess(C.get("Auth")), Id));
});

HoldsRoutes.post("/:Id/Purchase", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Raw = await C.req.text();
  const Body = Raw.trim() ? await ParseBody(C, PurchaseHoldBody) : {};
  return Ok(C, await PurchaseFromHold(await ResolveAccess(C.get("Auth")), Id, Body.PromoCode), 201);
});
