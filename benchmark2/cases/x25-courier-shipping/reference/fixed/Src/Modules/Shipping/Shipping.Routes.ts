import { Hono } from "hono";
import { Ok } from "../../Lib/Response";
import { HandleCourierWebhook } from "./Shipping.Service";

export const CourierWebhookRoutes = new Hono();

CourierWebhookRoutes.post("/Courier", async (C) => Ok(C, await HandleCourierWebhook(await C.req.text(), C.req.header("X-Signature") ?? "")));
