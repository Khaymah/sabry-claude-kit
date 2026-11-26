import { Hono } from "hono";
import { Ok } from "../../Lib/Response";
import * as WebhooksService from "./Webhooks.Service";

export const WebhooksRoutes = new Hono();

WebhooksRoutes.post("/Payments", async (C) => {
  const RawBody = await C.req.text();
  const Signature = C.req.header("X-Signature") ?? "";
  return Ok(C, await WebhooksService.HandlePaymentWebhook(RawBody, Signature));
});
