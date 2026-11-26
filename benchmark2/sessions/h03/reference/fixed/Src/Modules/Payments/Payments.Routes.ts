import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseQuery } from "../../Lib/Validate";
import { CreatePaymentBody, ListPaymentsQuery } from "./Payments.Schema";
import * as PaymentsService from "./Payments.Service";

export const PaymentsRoutes = new Hono<AppEnv>();
PaymentsRoutes.use("*", RequireAuth);

PaymentsRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, ListPaymentsQuery);
  return Ok(C, await PaymentsService.ListPayments(C.get("Auth"), Query.OrderId));
});

PaymentsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreatePaymentBody);
  return Ok(C, await PaymentsService.CreatePayment(C.get("Auth"), Body), 201);
});
