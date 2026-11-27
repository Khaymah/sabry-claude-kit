import { Hono, type Context } from "hono";
import { RequireAuth, RequireRole, type AppEnv } from "../../Middleware/Auth";
import { Ok } from "../../Lib/Response";
import { ParseBody, ParseId, ParseQuery } from "../../Lib/Validate";
import * as Schema from "./Ticketing.Schema";
import * as T from "./Ticketing.Service";

const ScopeOf = (C: Context<AppEnv>): T.Scope => {
  const Auth = C.get("Auth");
  return { CompanyId: Auth.CompanyId, UserId: Auth.UserId, Restricted: Auth.Role !== "Owner" && Auth.Role !== "Admin" };
};
const IdOf = (C: Context<AppEnv>, Name = "Id") => ParseId(C.req.param(Name));

function Router() {
  const R = new Hono<AppEnv>();
  R.use("*", RequireAuth);
  return R;
}

export const OrganizersRoutes = Router();
OrganizersRoutes.get("/", async (C) => Ok(C, await T.ListOrganizers(ScopeOf(C))));
OrganizersRoutes.post("/", RequireRole("Owner", "Admin"), async (C) => Ok(C, await T.CreateOrganizer(ScopeOf(C), (await ParseBody(C, Schema.OrganizerBody)).Name)));
OrganizersRoutes.post("/:Id/Staff", RequireRole("Owner", "Admin"), async (C) =>
  Ok(C, await T.Assign(ScopeOf(C), IdOf(C), (await ParseBody(C, Schema.StaffBody)).UserId, true)),
);
OrganizersRoutes.delete("/:Id/Staff/:UserId", RequireRole("Owner", "Admin"), async (C) => Ok(C, await T.Assign(ScopeOf(C), IdOf(C), IdOf(C, "UserId"), false)));
OrganizersRoutes.get("/:Id/Payout", async (C) => {
  const Id = IdOf(C);
  const Q = ParseQuery(C, Schema.PayoutQuery);
  return Ok(C, await T.Payout(ScopeOf(C), Id, Q.From, Q.To));
});

export const EventsRoutes = Router();
EventsRoutes.post("/", async (C) => Ok(C, await T.CreateEvent(ScopeOf(C), await ParseBody(C, Schema.EventBody))));
EventsRoutes.get("/:Id", async (C) => Ok(C, await T.GetEvent(ScopeOf(C), IdOf(C))));
EventsRoutes.get("/:Id/Availability", async (C) => Ok(C, await T.Availability(ScopeOf(C), IdOf(C))));
EventsRoutes.post("/:Id/Promos", async (C) => {
  const Id = IdOf(C);
  const Body = await ParseBody(C, Schema.PromoBody);
  return Ok(C, await T.AddPromo(ScopeOf(C), Id, Body.Code, Body.PercentOff));
});
EventsRoutes.post("/:Id/Cancel", async (C) => Ok(C, await T.CancelEvent(ScopeOf(C), IdOf(C))));

export const HoldsRoutes = Router();
HoldsRoutes.post("/", async (C) => Ok(C, await T.CreateHold(ScopeOf(C), await ParseBody(C, Schema.HoldBody))));
HoldsRoutes.get("/:Id", async (C) => Ok(C, await T.GetHold(ScopeOf(C), IdOf(C))));
HoldsRoutes.post("/:Id/Release", async (C) => Ok(C, await T.ReleaseHold(ScopeOf(C), IdOf(C))));
HoldsRoutes.post("/:Id/Purchase", async (C) => {
  const Id = IdOf(C);
  const Body = await ParseBody(C, Schema.PurchaseHoldBody);
  return Ok(C, await T.BuyHold(ScopeOf(C), Id, Body.PromoCode));
});

export const PurchasesRoutes = Router();
PurchasesRoutes.post("/", async (C) => Ok(C, await T.Buy(ScopeOf(C), await ParseBody(C, Schema.PurchaseBody))));
PurchasesRoutes.get("/:Id", async (C) => Ok(C, await T.GetOrder(ScopeOf(C), IdOf(C))));

export const GroupBookingsRoutes = Router();
GroupBookingsRoutes.post("/", async (C) => Ok(C, await T.Group(ScopeOf(C), await ParseBody(C, Schema.GroupBody))));

export const TicketsRoutes = Router();
TicketsRoutes.get("/:Id", async (C) => Ok(C, await T.GetTicket(ScopeOf(C), IdOf(C))));
TicketsRoutes.post("/:Id/Refund", async (C) => Ok(C, await T.RefundTicket(ScopeOf(C), IdOf(C))));
TicketsRoutes.post("/:Id/Transfer", async (C) => {
  const Id = IdOf(C);
  const Body = await ParseBody(C, Schema.TransferBody);
  return Ok(C, await T.TransferTicket(ScopeOf(C), Id, Body.Name, Body.Phone));
});

export const SessionsRoutes = Router();
SessionsRoutes.post("/:Id/CheckIn", async (C) => {
  const Id = IdOf(C);
  const Body = await ParseBody(C, Schema.CheckInBody);
  return Ok(C, await T.CheckIn(ScopeOf(C), Id, Body.Code));
});
