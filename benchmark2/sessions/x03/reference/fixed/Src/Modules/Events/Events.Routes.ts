import { Hono } from "hono";
import { RequireAuth, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId } from "../../Lib/Validate";
import { ResolveAccess } from "../Organizers/Organizers.Service";
import { CreateEventBody, CreatePromoBody } from "./Events.Schema";
import * as EventsService from "./Events.Service";

export const EventsRoutes = new Hono<AppEnv>();
EventsRoutes.use("*", RequireAuth);

EventsRoutes.post("/", async (C) => {
  const Body = await ParseBody(C, CreateEventBody);
  return Ok(C, await EventsService.CreateEvent(await ResolveAccess(C.get("Auth")), Body), 201);
});

EventsRoutes.get("/:Id", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await EventsService.GetEvent(await ResolveAccess(C.get("Auth")), Id));
});

EventsRoutes.get("/:Id/Availability", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await EventsService.Availability(await ResolveAccess(C.get("Auth")), Id));
});

EventsRoutes.post("/:Id/Promos", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  const Body = await ParseBody(C, CreatePromoBody);
  return Ok(C, await EventsService.CreatePromo(await ResolveAccess(C.get("Auth")), Id, Body), 201);
});

EventsRoutes.post("/:Id/Cancel", async (C) => {
  const Id = ParseId(C.req.param("Id"));
  return Ok(C, await EventsService.CancelEvent(await ResolveAccess(C.get("Auth")), Id));
});
