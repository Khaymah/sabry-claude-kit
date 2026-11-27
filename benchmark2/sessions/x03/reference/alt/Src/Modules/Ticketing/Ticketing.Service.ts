import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, EventSessions, Events, Holds, Inventory, Organizers, SeatCategories, StaffAssignments, TicketOrders, Tickets, Users } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { PhoneKey } from "../../Lib/Phone";

export type Scope = { CompanyId: number; UserId: number; Restricted: boolean };
type Ex = Transaction | typeof Db;
type Line = { SessionId: number; CategoryId: number; Quantity: number };

const NotFound = (What: string) => new AppError(404, "NOT_FOUND", `${What} not found`);
const Conflict = (Message: string) => new AppError(409, "CONFLICT", Message);
const Live = ["Valid", "CheckedIn"];
const FeeCutover = Date.parse("2026-12-31T22:00:00Z");

export function FeeOf(EventCreatedAt: Date) {
  return EventCreatedAt.getTime() >= FeeCutover ? { Percent: 7, Fixed: 200 } : { Percent: 10, Fixed: 0 };
}

export function TicketFee(Paid: number, EventCreatedAt: Date) {
  if (Paid <= 0) return 0;
  const Rule = FeeOf(EventCreatedAt);
  return Math.min(Paid, Math.floor((Paid * Rule.Percent) / 100) + Rule.Fixed);
}

function Visible(S: Scope, OrganizerColumn: unknown): SQL | undefined {
  if (!S.Restricted) return undefined;
  return sql`EXISTS (SELECT 1 FROM "StaffAssignments" SA WHERE SA."OrganizerId" = ${OrganizerColumn} AND SA."UserId" = ${S.UserId})`;
}

function NewCode() {
  const Bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(Bytes, (B) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[B % 32]).join("");
}

export async function ListOrganizers(S: Scope) {
  const Items = await Db.select({ Id: Organizers.Id, Name: Organizers.Name })
    .from(Organizers)
    .where(and(eq(Organizers.CompanyId, S.CompanyId), Visible(S, Organizers.Id)))
    .orderBy(Organizers.Id);
  return { Items };
}

export async function CreateOrganizer(S: Scope, Name: string) {
  const [Row] = await Db.insert(Organizers).values({ CompanyId: S.CompanyId, Name }).returning();
  return Row;
}

async function OrganizerOf(S: Scope, Id: number) {
  const [Row] = await Db.select().from(Organizers).where(and(eq(Organizers.Id, Id), eq(Organizers.CompanyId, S.CompanyId), Visible(S, Organizers.Id)));
  if (!Row) throw NotFound("Organizer");
  return Row;
}

export async function Assign(S: Scope, OrganizerId: number, UserId: number, On: boolean) {
  await OrganizerOf(S, OrganizerId);
  const [User] = await Db.select({ Id: Users.Id }).from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, S.CompanyId)));
  if (!User) throw NotFound("User");
  if (On) await Db.insert(StaffAssignments).values({ OrganizerId, UserId }).onConflictDoNothing();
  else await Db.delete(StaffAssignments).where(and(eq(StaffAssignments.OrganizerId, OrganizerId), eq(StaffAssignments.UserId, UserId)));
  return { OrganizerId, UserId, Assigned: On };
}

async function EventOf(Ex: Ex, S: Scope, Id: number) {
  const [Row] = await Ex.select().from(Events).where(and(eq(Events.Id, Id), eq(Events.CompanyId, S.CompanyId), Visible(S, Events.OrganizerId)));
  if (!Row) throw NotFound("Event");
  return Row;
}

async function SessionsOf(Ex: Ex, S: Scope, Ids: number[]) {
  const Rows = await Ex.select({ Session: EventSessions, Event: Events })
    .from(EventSessions)
    .innerJoin(Events, eq(Events.Id, EventSessions.EventId))
    .where(and(inArray(EventSessions.Id, Ids), eq(Events.CompanyId, S.CompanyId), Visible(S, Events.OrganizerId)));
  if (Rows.length !== new Set(Ids).size) throw NotFound("Session");
  return Rows;
}

function Sellable(Event: { Status: string }, Starts: Date[]) {
  if (Event.Status !== "OnSale") throw Conflict("Event is cancelled");
  if (Starts.some((D) => D.getTime() <= Now().getTime())) throw Conflict("Session already started");
}

async function CustomerOf(Ex: Ex, S: Scope, Id: number) {
  const [Row] = await Ex.select({ Id: Customers.Id }).from(Customers).where(and(eq(Customers.Id, Id), eq(Customers.CompanyId, S.CompanyId)));
  if (!Row) throw NotFound("Customer");
}

const HeldNow = (At: Date) =>
  sql`(SELECT coalesce(sum(H."Quantity"), 0) FROM "Holds" H WHERE H."SessionId" = ${Inventory.SessionId} AND H."CategoryId" = ${Inventory.CategoryId} AND H."Status" = 'Active' AND H."ExpiresAt" > ${At})`;

async function Take(Tx: Transaction, EventId: number, L: Line, Sell: boolean) {
  const Seat = and(
    eq(Inventory.SessionId, L.SessionId),
    eq(Inventory.CategoryId, L.CategoryId),
    sql`${Inventory.CategoryId} IN (SELECT "Id" FROM "SeatCategories" WHERE "EventId" = ${EventId})`,
  );
  const Rows = await Tx.update(Inventory)
    .set({ Sold: Sell ? sql`${Inventory.Sold} + ${L.Quantity}` : sql`${Inventory.Sold}` })
    .where(and(Seat, sql`${Inventory.Capacity} - ${Inventory.Sold} - ${HeldNow(Now())} >= ${L.Quantity}`))
    .returning({ Sold: Inventory.Sold });
  if (Rows.length) return;
  const [Exists] = await Tx.select({ Capacity: Inventory.Capacity }).from(Inventory).where(Seat);
  if (!Exists) throw NotFound("Seat category");
  throw Conflict("Not enough seats");
}

export async function CreateEvent(S: Scope, Input: { OrganizerId: number; Name: string; Sessions: { StartsAt: string }[]; Categories: { Name: string; Price: string; Capacity: number }[] }) {
  await OrganizerOf(S, Input.OrganizerId);
  const Id = await Db.transaction(async (Tx) => {
    const [Event] = await Tx.insert(Events)
      .values({ CompanyId: S.CompanyId, OrganizerId: Input.OrganizerId, Name: Input.Name, Status: "OnSale", Promos: {}, CreatedAt: Now() })
      .returning();
    const Sessions = await Tx.insert(EventSessions).values(Input.Sessions.map((X) => ({ EventId: Event.Id, StartsAt: new Date(X.StartsAt) }))).returning();
    const Cats = await Tx.insert(SeatCategories)
      .values(Input.Categories.map((C) => ({ EventId: Event.Id, Name: C.Name, PricePiasters: ToPiasters(C.Price), Capacity: C.Capacity })))
      .returning();
    await Tx.insert(Inventory).values(Sessions.flatMap((X) => Cats.map((C) => ({ SessionId: X.Id, CategoryId: C.Id, Capacity: C.Capacity, Sold: 0 }))));
    return Event.Id;
  });
  return GetEvent(S, Id);
}

export async function GetEvent(S: Scope, Id: number) {
  const Event = await EventOf(Db, S, Id);
  const Sessions = await Db.select({ Id: EventSessions.Id, StartsAt: EventSessions.StartsAt }).from(EventSessions).where(eq(EventSessions.EventId, Id)).orderBy(EventSessions.Id);
  const Cats = await Db.select().from(SeatCategories).where(eq(SeatCategories.EventId, Id)).orderBy(SeatCategories.Id);
  const Fee = FeeOf(Event.CreatedAt);
  return {
    Id: Event.Id,
    OrganizerId: Event.OrganizerId,
    Name: Event.Name,
    Status: Event.Status,
    FeePercent: Fee.Percent,
    FeeFixed: FromPiasters(Fee.Fixed),
    Sessions,
    Categories: Cats.map((C) => ({ Id: C.Id, Name: C.Name, Price: FromPiasters(C.PricePiasters), Capacity: C.Capacity })),
  };
}

export async function Availability(S: Scope, Id: number) {
  await EventOf(Db, S, Id);
  const Items = await Db.select({
    SessionId: Inventory.SessionId,
    CategoryId: Inventory.CategoryId,
    Capacity: Inventory.Capacity,
    Available: sql<number>`greatest(${Inventory.Capacity} - ${Inventory.Sold} - ${HeldNow(Now())}, 0)::int`,
  })
    .from(Inventory)
    .innerJoin(EventSessions, eq(EventSessions.Id, Inventory.SessionId))
    .where(eq(EventSessions.EventId, Id))
    .orderBy(Inventory.SessionId, Inventory.CategoryId);
  return { Items };
}

export async function AddPromo(S: Scope, EventId: number, Code: string, PercentOff: number) {
  await EventOf(Db, S, EventId);
  const Rows = await Db.update(Events)
    .set({ Promos: sql`${Events.Promos} || jsonb_build_object(${Code}::text, ${PercentOff}::int)` })
    .where(and(eq(Events.Id, EventId), sql`NOT (${Events.Promos} ? ${Code})`))
    .returning({ Id: Events.Id });
  if (!Rows.length) throw new AppError(400, "DUPLICATE_CODE", "Promo code already used in this event");
  return { EventId, Code, PercentOff };
}

function PromoPercent(Event: { Promos: Record<string, number> }, Code: string | undefined) {
  if (Code === undefined) return 0;
  const Percent = Event.Promos[Code];
  if (Percent === undefined) throw new AppError(400, "INVALID_PROMO", "Unknown promo code");
  return Percent;
}

function ShowHold(H: typeof Holds.$inferSelect) {
  const Status = H.Status === "Active" && H.ExpiresAt.getTime() <= Now().getTime() ? "Expired" : H.Status;
  return { Id: H.Id, SessionId: H.SessionId, CategoryId: H.CategoryId, CustomerId: H.CustomerId, Quantity: H.Quantity, Status, ExpiresAt: H.ExpiresAt };
}

async function HoldOf(Ex: Ex, S: Scope, Id: number) {
  const [Row] = await Ex.select({ Hold: Holds })
    .from(Holds)
    .innerJoin(Events, eq(Events.Id, Holds.EventId))
    .where(and(eq(Holds.Id, Id), eq(Holds.CompanyId, S.CompanyId), Visible(S, Events.OrganizerId)));
  if (!Row) throw NotFound("Hold");
  return Row.Hold;
}

export async function CreateHold(S: Scope, Input: Line & { CustomerId: number }) {
  return Db.transaction(async (Tx) => {
    await CustomerOf(Tx, S, Input.CustomerId);
    const [{ Session, Event }] = await SessionsOf(Tx, S, [Input.SessionId]);
    await Take(Tx, Event.Id, Input, false);
    Sellable(Event, [Session.StartsAt]);
    const [Hold] = await Tx.insert(Holds)
      .values({ CompanyId: S.CompanyId, EventId: Event.Id, ...Input, Status: "Active", ExpiresAt: new Date(Now().getTime() + 600_000) })
      .returning();
    return ShowHold(Hold);
  });
}

export async function GetHold(S: Scope, Id: number) {
  return ShowHold(await HoldOf(Db, S, Id));
}

export async function ReleaseHold(S: Scope, Id: number) {
  await HoldOf(Db, S, Id);
  const [Row] = await Db.update(Holds)
    .set({ Status: "Released" })
    .where(and(eq(Holds.Id, Id), eq(Holds.Status, "Active"), sql`${Holds.ExpiresAt} > ${Now()}`))
    .returning();
  if (!Row) throw Conflict("Hold is not active");
  return ShowHold(Row);
}

async function Issue(Tx: Transaction, S: Scope, EventId: number, CustomerId: number, Lines: Line[], Percent: number, HoldId: number | null) {
  const Cats = await Tx.select().from(SeatCategories).where(eq(SeatCategories.EventId, EventId));
  const Price = new Map(Cats.map((C) => [C.Id, C.PricePiasters]));
  const At = Now();
  const Rows = Lines.flatMap((L) => {
    const Full = Price.get(L.CategoryId);
    if (Full === undefined) throw NotFound("Seat category");
    const Paid = Full - Math.floor((Full * Math.min(Percent, 100)) / 100);
    return Array.from({ length: L.Quantity }, () => ({ ...L, Full, Paid }));
  });
  const Total = Rows.reduce((A, R) => A + R.Paid, 0);
  const Discount = Rows.reduce((A, R) => A + R.Full - R.Paid, 0);
  const [Order] = await Tx.insert(TicketOrders)
    .values({ CompanyId: S.CompanyId, EventId, CustomerId, HoldId, TotalPiasters: Total, DiscountPiasters: Discount, CreatedAt: At })
    .returning();
  const Made = await Tx.insert(Tickets)
    .values(
      Rows.map((R) => ({
        CompanyId: S.CompanyId,
        OrderId: Order.Id,
        EventId,
        SessionId: R.SessionId,
        CategoryId: R.CategoryId,
        HolderCustomerId: CustomerId,
        PaidPiasters: R.Paid,
        Code: NewCode(),
        Status: "Valid",
        CreatedAt: At,
      })),
    )
    .returning();
  return ShowOrder(Order, Made);
}

function ShowTicket(T: typeof Tickets.$inferSelect) {
  return {
    Id: T.Id,
    PurchaseId: T.OrderId,
    SessionId: T.SessionId,
    CategoryId: T.CategoryId,
    HolderCustomerId: T.HolderCustomerId,
    Price: FromPiasters(T.PaidPiasters),
    Code: T.Code,
    Status: T.Status,
  };
}

function ShowOrder(O: typeof TicketOrders.$inferSelect, T: (typeof Tickets.$inferSelect)[]) {
  return {
    Id: O.Id,
    EventId: O.EventId,
    CustomerId: O.CustomerId,
    Total: FromPiasters(O.TotalPiasters),
    Discount: FromPiasters(O.DiscountPiasters),
    Tickets: [...T].sort((A, B) => A.Id - B.Id).map(ShowTicket),
  };
}

export async function BuyHold(S: Scope, Id: number, PromoCode: string | undefined) {
  return Db.transaction(async (Tx) => {
    const Hold = await HoldOf(Tx, S, Id);
    const [{ Session, Event }] = await SessionsOf(Tx, S, [Hold.SessionId]);
    const Percent = PromoPercent(Event, PromoCode);
    const Claimed = await Tx.update(Holds)
      .set({ Status: "Purchased" })
      .where(and(eq(Holds.Id, Id), eq(Holds.Status, "Active"), sql`${Holds.ExpiresAt} > ${Now()}`))
      .returning();
    if (!Claimed.length) throw Conflict("Hold is not active");
    Sellable(Event, [Session.StartsAt]);
    await Tx.update(Inventory)
      .set({ Sold: sql`${Inventory.Sold} + ${Hold.Quantity}` })
      .where(and(eq(Inventory.SessionId, Hold.SessionId), eq(Inventory.CategoryId, Hold.CategoryId)));
    return Issue(Tx, S, Event.Id, Hold.CustomerId, [Hold], Percent, Hold.Id);
  });
}

export async function Buy(S: Scope, Input: Line & { CustomerId: number; PromoCode?: string }) {
  return Book(S, Input.CustomerId, [Input], Input.PromoCode, false);
}

export async function Group(S: Scope, Input: { CustomerId: number; PromoCode?: string; Lines: Line[] }) {
  const Count = Input.Lines.reduce((A, L) => A + L.Quantity, 0);
  if (Count > 100) throw new AppError(400, "VALIDATION_ERROR", "At most 100 tickets per booking");
  return Book(S, Input.CustomerId, Input.Lines, Input.PromoCode, Count >= 20);
}

async function Book(S: Scope, CustomerId: number, Lines: Line[], PromoCode: string | undefined, IsGroup: boolean) {
  return Db.transaction(async (Tx) => {
    await CustomerOf(Tx, S, CustomerId);
    const Found = await SessionsOf(Tx, S, Lines.map((L) => L.SessionId));
    const Event = Found[0].Event;
    if (Found.some((F) => F.Event.Id !== Event.Id)) throw new AppError(400, "VALIDATION_ERROR", "All lines must be from one event");
    const Merged = new Map<string, Line>();
    for (const L of Lines) {
      const Key = `${L.SessionId}:${L.CategoryId}`;
      const Prev = Merged.get(Key);
      Merged.set(Key, { ...L, Quantity: (Prev?.Quantity ?? 0) + L.Quantity });
    }
    for (const L of Merged.values()) await Take(Tx, Event.Id, L, true);
    Sellable(Event, Found.map((F) => F.Session.StartsAt));
    const Percent = PromoPercent(Event, PromoCode) + (IsGroup ? 5 : 0);
    return Issue(Tx, S, Event.Id, CustomerId, Lines, Percent, null);
  });
}

export async function GetOrder(S: Scope, Id: number) {
  const [Row] = await Db.select({ Order: TicketOrders })
    .from(TicketOrders)
    .innerJoin(Events, eq(Events.Id, TicketOrders.EventId))
    .where(and(eq(TicketOrders.Id, Id), eq(TicketOrders.CompanyId, S.CompanyId), Visible(S, Events.OrganizerId)));
  if (!Row) throw NotFound("Purchase");
  return ShowOrder(Row.Order, await Db.select().from(Tickets).where(eq(Tickets.OrderId, Id)));
}

async function TicketOf(Ex: Ex, S: Scope, Where: SQL | undefined) {
  const [Row] = await Ex.select({ Ticket: Tickets, StartsAt: EventSessions.StartsAt })
    .from(Tickets)
    .innerJoin(Events, eq(Events.Id, Tickets.EventId))
    .innerJoin(EventSessions, eq(EventSessions.Id, Tickets.SessionId))
    .where(and(Where, eq(Tickets.CompanyId, S.CompanyId), Visible(S, Events.OrganizerId)));
  return Row;
}

export async function GetTicket(S: Scope, Id: number) {
  const Row = await TicketOf(Db, S, eq(Tickets.Id, Id));
  if (!Row) throw NotFound("Ticket");
  return ShowTicket(Row.Ticket);
}

export async function CheckIn(S: Scope, SessionId: number, Code: string) {
  const [{ Session }] = await SessionsOf(Db, S, [SessionId]);
  const Row = await TicketOf(Db, S, eq(Tickets.Code, Code));
  if (!Row) throw NotFound("Ticket");
  if (Row.Ticket.SessionId !== SessionId) throw Conflict("Ticket is for another session");
  if (Now().getTime() < Session.StartsAt.getTime() - 3 * 3600_000) throw Conflict("Gate is not open yet");
  const [Done] = await Db.update(Tickets)
    .set({ Status: "CheckedIn", CheckedInAt: Now() })
    .where(and(eq(Tickets.Id, Row.Ticket.Id), eq(Tickets.Code, Code), eq(Tickets.Status, "Valid")))
    .returning({ Id: Tickets.Id });
  if (!Done) throw Conflict("Ticket cannot enter");
  return { TicketId: Done.Id, Status: "CheckedIn" };
}

export async function RefundTicket(S: Scope, Id: number) {
  return Db.transaction(async (Tx) => {
    const Row = await TicketOf(Tx, S, eq(Tickets.Id, Id));
    if (!Row) throw NotFound("Ticket");
    const Left = Row.StartsAt.getTime() - Now().getTime();
    if (Row.Ticket.Status === "Valid" && Left <= 0) throw Conflict("Session already started");
    const Amount = Left > 48 * 3600_000 ? Row.Ticket.PaidPiasters : Math.floor(Row.Ticket.PaidPiasters / 2);
    const [Done] = await Tx.update(Tickets)
      .set({ Status: "Refunded", RefundPiasters: Amount, RefundedAt: Now() })
      .where(and(eq(Tickets.Id, Id), eq(Tickets.Status, "Valid")))
      .returning();
    if (!Done) throw Conflict("Ticket cannot be refunded");
    await Tx.update(Inventory)
      .set({ Sold: sql`${Inventory.Sold} - 1` })
      .where(and(eq(Inventory.SessionId, Done.SessionId), eq(Inventory.CategoryId, Done.CategoryId)));
    return { TicketId: Id, Amount: FromPiasters(Amount), Status: "Refunded" };
  });
}

export async function TransferTicket(S: Scope, Id: number, Name: string, Phone: string) {
  const Key = PhoneKey(Phone);
  if (!Key) throw new AppError(400, "VALIDATION_ERROR", "Phone must be an Egyptian mobile number");
  return Db.transaction(async (Tx) => {
    if (!(await TicketOf(Tx, S, eq(Tickets.Id, Id)))) throw NotFound("Ticket");
    const [Known] = await Tx.select({ Id: Customers.Id })
      .from(Customers)
      .where(and(eq(Customers.CompanyId, S.CompanyId), eq(Customers.PhoneKey, Key)))
      .orderBy(Customers.Id)
      .limit(1);
    const Holder = Known?.Id ?? (await Tx.insert(Customers).values({ CompanyId: S.CompanyId, Name, Phone: Key, PhoneKey: Key }).returning())[0].Id;
    const [Done] = await Tx.update(Tickets)
      .set({ HolderCustomerId: Holder, Code: NewCode() })
      .where(and(eq(Tickets.Id, Id), eq(Tickets.Status, "Valid")))
      .returning();
    if (!Done) throw Conflict("Ticket cannot be transferred");
    return ShowTicket(Done);
  });
}

export async function CancelEvent(S: Scope, Id: number) {
  await EventOf(Db, S, Id);
  return Db.transaction(async (Tx) => {
    const At = Now();
    const [Event] = await Tx.update(Events).set({ Status: "Cancelled", CancelledAt: At }).where(and(eq(Events.Id, Id), eq(Events.Status, "OnSale"))).returning();
    if (!Event) throw Conflict("Event already cancelled");
    const Back = await Tx.update(Tickets)
      .set({ Status: "Refunded", RefundPiasters: sql`${Tickets.PaidPiasters}`, RefundedAt: At })
      .where(and(eq(Tickets.EventId, Id), inArray(Tickets.Status, Live)))
      .returning({ Paid: Tickets.PaidPiasters });
    await Tx.update(Holds).set({ Status: "Cancelled" }).where(and(eq(Holds.EventId, Id), eq(Holds.Status, "Active")));
    await Tx.update(Inventory).set({ Sold: 0 }).where(sql`${Inventory.SessionId} IN (SELECT "Id" FROM "EventSessions" WHERE "EventId" = ${Id})`);
    return { Id, Status: "Cancelled", RefundedTickets: Back.length, RefundedAmount: FromPiasters(Back.reduce((A, T) => A + T.Paid, 0)) };
  });
}

export async function Payout(S: Scope, OrganizerId: number, From: string, To: string) {
  if (From > To) throw new AppError(400, "VALIDATION_ERROR", "From must not be after To");
  await OrganizerOf(S, OrganizerId);
  const Start = sql`(${From}::date)::timestamp AT TIME ZONE 'Africa/Cairo'`;
  const End = sql`((${To}::date + 1)::timestamp) AT TIME ZONE 'Africa/Cairo'`;
  const Sold = await Db.select({ Paid: Tickets.PaidPiasters, EventCreatedAt: Events.CreatedAt, EventStatus: Events.Status })
    .from(Tickets)
    .innerJoin(Events, eq(Events.Id, Tickets.EventId))
    .where(and(eq(Events.CompanyId, S.CompanyId), eq(Events.OrganizerId, OrganizerId), sql`${Tickets.CreatedAt} >= ${Start} AND ${Tickets.CreatedAt} < ${End}`));
  const [Back] = await Db.select({ Sum: sql<number>`coalesce(sum(${Tickets.RefundPiasters}), 0)::int` })
    .from(Tickets)
    .innerJoin(Events, eq(Events.Id, Tickets.EventId))
    .where(and(eq(Events.CompanyId, S.CompanyId), eq(Events.OrganizerId, OrganizerId), sql`${Tickets.RefundedAt} >= ${Start} AND ${Tickets.RefundedAt} < ${End}`));
  const Sales = Sold.reduce((A, R) => A + R.Paid, 0);
  const Fee = Sold.reduce((A, R) => A + (R.EventStatus === "Cancelled" ? 0 : TicketFee(R.Paid, R.EventCreatedAt)), 0);
  const Refunds = Number(Back.Sum);
  return { OrganizerId, From, To, Sales: FromPiasters(Sales), Refunds: FromPiasters(Refunds), Fee: FromPiasters(Fee), Net: FromPiasters(Sales - Refunds - Fee) };
}
