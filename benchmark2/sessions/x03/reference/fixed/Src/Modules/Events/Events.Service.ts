import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Events, EventSessions, Holds, Promos, Refunds, SeatCategories, Tickets } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { FindOrganizer, OrganizerScope, type Access } from "../Organizers/Organizers.Service";

type Executor = Transaction | typeof Db;
type EventInput = {
  OrganizerId: number;
  Name: string;
  Sessions: { StartsAt: string }[];
  Categories: { Name: string; Price: string; Capacity: number }[];
};

const NewFeeRuleFrom = new Date("2026-12-31T22:00:00Z");

export function FeeRuleFor(CreatedAt: Date) {
  return CreatedAt >= NewFeeRuleFrom ? { FeePercent: 7, FeeFixed: "2.00" } : { FeePercent: 10, FeeFixed: "0.00" };
}

export const TakenStatuses = ["Valid", "CheckedIn"];

export async function FindEvent(Executor: Executor, Access: Access, Id: number, Lock = false) {
  const Query = Executor.select()
    .from(Events)
    .where(and(eq(Events.Id, Id), eq(Events.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
  const [Event] = Lock ? await Query.for("update") : await Query;
  if (!Event) throw new AppError(404, "NOT_FOUND", "Event not found");
  return Event;
}

export async function FindSession(Executor: Executor, Access: Access, SessionId: number) {
  const [Row] = await Executor.select({ Session: EventSessions, Event: Events })
    .from(EventSessions)
    .innerJoin(Events, eq(Events.Id, EventSessions.EventId))
    .where(and(eq(EventSessions.Id, SessionId), eq(Events.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Session not found");
  return Row;
}

export function RequireOnSale(Event: { Status: string }, Sessions: { StartsAt: Date }[]) {
  if (Event.Status !== "OnSale") throw new AppError(409, "EVENT_CANCELLED", "Event is not on sale");
  if (Sessions.some((S) => S.StartsAt <= Now())) throw new AppError(409, "SESSION_STARTED", "Session already started");
}

export async function LockCategories(Tx: Transaction, EventId: number, CategoryIds: number[]) {
  const Unique = [...new Set(CategoryIds)].sort((A, B) => A - B);
  const Rows = await Tx.select()
    .from(SeatCategories)
    .where(and(eq(SeatCategories.EventId, EventId), inArray(SeatCategories.Id, Unique)))
    .orderBy(asc(SeatCategories.Id))
    .for("update");
  if (Rows.length !== Unique.length) throw new AppError(404, "NOT_FOUND", "Seat category not found");
  return new Map(Rows.map((R) => [R.Id, R]));
}

export async function TakenSeats(Executor: Executor, EventId: number) {
  const At = Now();
  const Sold = await Executor.select({ SessionId: Tickets.SessionId, CategoryId: Tickets.CategoryId, Count: sql<number>`count(*)::int` })
    .from(Tickets)
    .where(and(eq(Tickets.EventId, EventId), inArray(Tickets.Status, TakenStatuses)))
    .groupBy(Tickets.SessionId, Tickets.CategoryId);
  const Held = await Executor.select({ SessionId: Holds.SessionId, CategoryId: Holds.CategoryId, Count: sql<number>`sum(${Holds.Quantity})::int` })
    .from(Holds)
    .where(and(eq(Holds.EventId, EventId), eq(Holds.Status, "Active"), gt(Holds.ExpiresAt, At)))
    .groupBy(Holds.SessionId, Holds.CategoryId);
  const Taken = new Map<string, number>();
  for (const R of [...Sold, ...Held]) {
    const Key = `${R.SessionId}:${R.CategoryId}`;
    Taken.set(Key, (Taken.get(Key) ?? 0) + Number(R.Count));
  }
  return Taken;
}

export async function CreateEvent(Access: Access, Input: EventInput) {
  await FindOrganizer(Access, Input.OrganizerId);
  const CreatedAt = Now();
  const Id = await Db.transaction(async (Tx) => {
    const [Event] = await Tx.insert(Events)
      .values({ CompanyId: Access.CompanyId, OrganizerId: Input.OrganizerId, Name: Input.Name, CreatedAt, ...FeeRuleFor(CreatedAt) })
      .returning({ Id: Events.Id });
    await Tx.insert(EventSessions).values(Input.Sessions.map((S) => ({ EventId: Event.Id, StartsAt: new Date(S.StartsAt) })));
    await Tx.insert(SeatCategories).values(
      Input.Categories.map((C) => ({ EventId: Event.Id, Name: C.Name, Price: FromPiasters(ToPiasters(C.Price)), Capacity: C.Capacity })),
    );
    return Event.Id;
  });
  return GetEvent(Access, Id);
}

export async function GetEvent(Access: Access, Id: number) {
  const Event = await FindEvent(Db, Access, Id);
  const Sessions = await Db.select({ Id: EventSessions.Id, StartsAt: EventSessions.StartsAt })
    .from(EventSessions)
    .where(eq(EventSessions.EventId, Id))
    .orderBy(asc(EventSessions.StartsAt), asc(EventSessions.Id));
  const Categories = await Db.select({ Id: SeatCategories.Id, Name: SeatCategories.Name, Price: SeatCategories.Price, Capacity: SeatCategories.Capacity })
    .from(SeatCategories)
    .where(eq(SeatCategories.EventId, Id))
    .orderBy(asc(SeatCategories.Id));
  return {
    Id: Event.Id,
    OrganizerId: Event.OrganizerId,
    Name: Event.Name,
    Status: Event.Status,
    FeePercent: Event.FeePercent,
    FeeFixed: Event.FeeFixed,
    CreatedAt: Event.CreatedAt,
    Sessions,
    Categories,
  };
}

export async function Availability(Access: Access, Id: number) {
  const Event = await GetEvent(Access, Id);
  const Taken = await TakenSeats(Db, Id);
  const Items = Event.Sessions.flatMap((S) =>
    Event.Categories.map((C) => ({
      SessionId: S.Id,
      CategoryId: C.Id,
      Capacity: C.Capacity,
      Available: Math.max(0, C.Capacity - (Taken.get(`${S.Id}:${C.Id}`) ?? 0)),
    })),
  );
  return { Items };
}

export async function CreatePromo(Access: Access, EventId: number, Input: { Code: string; PercentOff: number }) {
  await FindEvent(Db, Access, EventId);
  const [Row] = await Db.insert(Promos).values({ EventId, Code: Input.Code, PercentOff: Input.PercentOff }).onConflictDoNothing().returning();
  if (!Row) throw new AppError(409, "DUPLICATE_CODE", "Promo code already exists for this event");
  return { Id: Row.Id, EventId, Code: Row.Code, PercentOff: Row.PercentOff };
}

export async function FindPromo(Executor: Executor, EventId: number, Code: string | undefined) {
  if (Code === undefined) return 0;
  const [Row] = await Executor.select().from(Promos).where(and(eq(Promos.EventId, EventId), eq(Promos.Code, Code.trim())));
  if (!Row) throw new AppError(400, "INVALID_PROMO", "Promo code is not valid for this event");
  return Row.PercentOff;
}

export async function CancelEvent(Access: Access, Id: number) {
  return Db.transaction(async (Tx) => {
    const Event = await FindEvent(Tx, Access, Id, true);
    if (Event.Status !== "OnSale") throw new AppError(409, "INVALID_STATUS", "Event is already cancelled");
    const At = Now();
    await Tx.update(Events).set({ Status: "Cancelled", CancelledAt: At }).where(eq(Events.Id, Id));
    const Refunded = await Tx.update(Tickets)
      .set({ Status: "Refunded" })
      .where(and(eq(Tickets.EventId, Id), inArray(Tickets.Status, TakenStatuses)))
      .returning({ Id: Tickets.Id, Price: Tickets.Price });
    if (Refunded.length) {
      await Tx.insert(Refunds).values(Refunded.map((T) => ({ CompanyId: Access.CompanyId, TicketId: T.Id, EventId: Id, Amount: T.Price, CreatedAt: At })));
    }
    await Tx.update(Holds).set({ Status: "Cancelled" }).where(and(eq(Holds.EventId, Id), eq(Holds.Status, "Active")));
    const Amount = Refunded.reduce((Sum, T) => Sum + ToPiasters(T.Price), 0);
    return { Id, Status: "Cancelled", RefundedTickets: Refunded.length, RefundedAmount: FromPiasters(Amount) };
  });
}
