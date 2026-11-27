import { Hono } from "hono";
import { Ok } from "../../Lib/Response";
import { HandleGatewayWebhook } from "./Checkout.Service";

export const GatewayWebhookRoutes = new Hono();

GatewayWebhookRoutes.post("/Gateway", async (C) => Ok(C, await HandleGatewayWebhook(await C.req.text(), C.req.header("X-Signature") ?? "")));
