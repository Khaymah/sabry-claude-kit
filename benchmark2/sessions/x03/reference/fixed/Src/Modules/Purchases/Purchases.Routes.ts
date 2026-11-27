import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ResolveAccess } from "../Organizers/Organizers.Service";
import { DirectPurchaseBody, GroupBookingBody } from "./Purchases.Schema";
import * as PurchasesService from "./Purchases.Service";

export const PurchasesRoutes = new Hono<AppEnv>();
PurchasesRoutes.use("*", RequireAuth);

PurchasesRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, DirectPurchaseBody);
  return Ok(C, await PurchasesService.DirectPurchase(await ResolveAccess(C.get("Auth")), Body), 201);
});

PurchasesRoutes.get("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await PurchasesService.GetPurchase(await ResolveAccess(C.get("Auth")), Id));
});

export const GroupBookingsRoutes = new Hono<AppEnv>();
GroupBookingsRoutes.use("*", RequireAuth);

GroupBookingsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, GroupBookingBody);
  return Ok(C, await PurchasesService.GroupBooking(await ResolveAccess(C.get("Auth")), Body), 201);
});
