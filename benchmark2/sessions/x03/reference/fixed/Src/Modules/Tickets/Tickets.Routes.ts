import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ResolveAccess } from "../Organizers/Organizers.Service";
import { CheckInBody, TransferBody } from "./Tickets.Schema";
import * as TicketsService from "./Tickets.Service";

export const TicketsRoutes = new Hono<AppEnv>();
TicketsRoutes.use("*", RequireAuth);

TicketsRoutes.get("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await TicketsService.GetTicket(await ResolveAccess(C.get("Auth")), Id));
});

TicketsRoutes.post("/:Id/Refund", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await TicketsService.RefundTicket(await ResolveAccess(C.get("Auth")), Id));
});

TicketsRoutes.post("/:Id/Transfer", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, TransferBody);
  return Ok(C, await TicketsService.TransferTicket(await ResolveAccess(C.get("Auth")), Id, Body));
});

export const SessionsRoutes = new Hono<AppEnv>();
SessionsRoutes.use("*", RequireAuth);

SessionsRoutes.post("/:Id/CheckIn", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, CheckInBody);
  return Ok(C, await TicketsService.CheckIn(await ResolveAccess(C.get("Auth")), Id, Body.Code));
});
