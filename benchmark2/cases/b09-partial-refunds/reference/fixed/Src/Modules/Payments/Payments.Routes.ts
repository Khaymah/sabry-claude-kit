import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import { CreatePaymentBody, CreateRefundBody, ListPaymentsQuery } from "./Payments.Schema";
import * as PaymentsService from "./Payments.Service";

export const PaymentsRoutes = new Hono<AppEnv>();
PaymentsRoutes.use("*", RequireAuth);

PaymentsRoutes.get("/", async (C) => {
  const Query = ParseQuery(C, ListPaymentsQuery);
  return Ok(C, await PaymentsService.ListPayments(C.get("Auth").CompanyId, Query.OrderId));
});

PaymentsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreatePaymentBody);
  return Ok(C, await PaymentsService.CreatePayment(C.get("Auth").CompanyId, Body), 201);
});

PaymentsRoutes.get("/:Id/Refunds", async (C) =>
  Ok(C, await PaymentsService.ListRefunds(C.get("Auth").CompanyId, ParseId(C.req.param("Id")))),
);

PaymentsRoutes.post("/:Id/Refunds", async (C) => {
  const Body = await ParseBody(C, CreateRefundBody);
  return Ok(C, await PaymentsService.CreateRefund(C.get("Auth").CompanyId, ParseId(C.req.param("Id")), Body), 201);
});
