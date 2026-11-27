import { Hono } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { SendPaymentReminders } from "./Jobs.Service";

export const JobsRoutes = new Hono<AppEnv>();
JobsRoutes.use("*", RequireAuth, RequireRole("Owner", "Admin"));

JobsRoutes.post("/PaymentReminders", async (C) => Ok(C, await SendPaymentReminders(C.get("Auth").CompanyId)));
