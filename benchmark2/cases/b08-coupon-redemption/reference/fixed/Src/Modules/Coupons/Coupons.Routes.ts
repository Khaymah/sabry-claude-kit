import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody } from "../../Lib/Validate";
import { CreateCouponBody } from "./Coupons.Schema";
import * as CouponsService from "./Coupons.Service";

export const CouponsRoutes = new Hono<AppEnv>();
CouponsRoutes.use("*", RequireAuth);

CouponsRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => {
  const Body = await ParseBody(C, CreateCouponBody);
  return Ok(C, await CouponsService.CreateCoupon(C.get("Auth").CompanyId, Body), 201);
});
