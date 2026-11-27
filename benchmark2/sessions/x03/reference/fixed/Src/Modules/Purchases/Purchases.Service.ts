import { and, asc, eq, inArray } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { EventSessions, Events, Holds, Purchases, Tickets } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { OrganizerScope, type Access } from "../Organizers/Organizers.Service";
import { FindPromo, FindSession, LockCategories, RequireOnSale, TakenSeats } from "../Events/Events.Service";
import { FindHold, RequireCustomer, ShowHold } from "../Holds/Holds.Service";
import { NewTicketCode, ShowTicket } from "../Tickets/Tickets.Service";

type Line = { SessionId: number; CategoryId: number; Quantity: number };
type EventRow = typeof Events.$inferSelect;

const GroupMinTickets = 20;
const GroupPercent = 5;

export function DiscountedPrice(PricePiasters: number, Percent: number) {
  const Discount = Math.floor((PricePiasters * Math.min(Percent, 100)) / 100);
  return { Paid: PricePiasters - Discount, Discount };
}

async function Issue(Tx: Transaction, Access: Access, Event: EventRow, CustomerId: number, Lines: Line[], Percent: number, HoldId: number | null) {
  const Categories = await LockCategories(Tx, Event.Id, Lines.map((L) => L.CategoryId));
  if (HoldId === null) {
    const Taken = await TakenSeats(Tx, Event.Id);
    const Wanted = new Map<string, number>();
    for (const L of Lines) Wanted.set(`${L.SessionId}:${L.CategoryId}`, (Wanted.get(`${L.SessionId}:${L.CategoryId}`) ?? 0) + L.Quantity);
    for (const [Key, Quantity] of Wanted) {
      const CategoryId = Number(Key.split(":")[1]);
      if (Categories.get(CategoryId)!.Capacity - (Taken.get(Key) ?? 0) < Quantity) throw new AppError(409, "SOLD_OUT", "Not enough seats");
    }
  }
  const At = Now();
  const Rows: { SessionId: number; CategoryId: number; Paid: number; Discount: number }[] = [];
  for (const L of Lines) {
    const Price = DiscountedPrice(ToPiasters(Categories.get(L.CategoryId)!.Price), Percent);
    for (let I = 0; I < L.Quantity; I++) Rows.push({ SessionId: L.SessionId, CategoryId: L.CategoryId, ...Price });
  }
  const Total = Rows.reduce((Sum, R) => Sum + R.Paid, 0);
  const Discount = Rows.reduce((Sum, R) => Sum + R.Discount, 0);
  const [Purchase] = await Tx.insert(Purchases)
    .values({ CompanyId: Access.CompanyId, EventId: Event.Id, CustomerId, HoldId, Total: FromPiasters(Total), Discount: FromPiasters(Discount), CreatedAt: At })
    .returning();
  const Created = await Tx.insert(Tickets)
    .values(
      Rows.map((R) => ({
        CompanyId: Access.CompanyId,
        PurchaseId: Purchase.Id,
        EventId: Event.Id,
        SessionId: R.SessionId,
        CategoryId: R.CategoryId,
        HolderCustomerId: CustomerId,
        Price: FromPiasters(R.Paid),
        Code: NewTicketCode(),
        CreatedAt: At,
      })),
    )
    .returning();
  return ShowPurchase(Purchase, Created);
}

function ShowPurchase(Purchase: typeof Purchases.$inferSelect, Rows: (typeof Tickets.$inferSelect)[]) {
  return {
    Id: Purchase.Id,
    EventId: Purchase.EventId,
    CustomerId: Purchase.CustomerId,
    Total: Purchase.Total,
    Discount: Purchase.Discount,
    Tickets: Rows.sort((A, B) => A.Id - B.Id).map(ShowTicket),
  };
}

export async function PurchaseFromHold(Access: Access, HoldId: number, PromoCode: string | undefined) {
  return Db.transaction(async (Tx) => {
    const Hold = await FindHold(Tx, Access, HoldId, true);
    if (ShowHold(Hold).Status !== "Active") throw new AppError(409, "INVALID_STATUS", "Hold is not active");
    const { Session, Event } = await FindSession(Tx, Access, Hold.SessionId);
    RequireOnSale(Event, [Session]);
    const Percent = await FindPromo(Tx, Event.Id, PromoCode);
    await Tx.update(Holds).set({ Status: "Purchased" }).where(eq(Holds.Id, HoldId));
    return Issue(Tx, Access, Event, Hold.CustomerId, [{ SessionId: Hold.SessionId, CategoryId: Hold.CategoryId, Quantity: Hold.Quantity }], Percent, Hold.Id);
  });
}

export async function DirectPurchase(Access: Access, Input: Line & { CustomerId: number; PromoCode?: string }) {
  return Db.transaction(async (Tx) => {
    await RequireCustomer(Tx, Access.CompanyId, Input.CustomerId);
    const { Session, Event } = await FindSession(Tx, Access, Input.SessionId);
    await LockCategories(Tx, Event.Id, [Input.CategoryId]);
    RequireOnSale(Event, [Session]);
    const Percent = await FindPromo(Tx, Event.Id, Input.PromoCode);
    return Issue(Tx, Access, Event, Input.CustomerId, [Input], Percent, null);
  });
}

export async function GroupBooking(Access: Access, Input: { CustomerId: number; PromoCode?: string; Lines: Line[] }) {
  return Db.transaction(async (Tx) => {
    await RequireCustomer(Tx, Access.CompanyId, Input.CustomerId);
    const SessionIds = [...new Set(Input.Lines.map((L) => L.SessionId))];
    const Sessions = await Tx.select({ Session: EventSessions, Event: Events })
      .from(EventSessions)
      .innerJoin(Events, eq(Events.Id, EventSessions.EventId))
      .where(and(inArray(EventSessions.Id, SessionIds), eq(Events.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
    if (Sessions.length !== SessionIds.length) throw new AppError(404, "NOT_FOUND", "Session not found");
    const Event = Sessions[0].Event;
    if (Sessions.some((S) => S.Event.Id !== Event.Id)) throw new AppError(400, "VALIDATION_ERROR", "All lines must belong to one event");
    await LockCategories(Tx, Event.Id, Input.Lines.map((L) => L.CategoryId));
    RequireOnSale(Event, Sessions.map((S) => S.Session));
    const Count = Input.Lines.reduce((Sum, L) => Sum + L.Quantity, 0);
    const Percent = (await FindPromo(Tx, Event.Id, Input.PromoCode)) + (Count >= GroupMinTickets ? GroupPercent : 0);
    return Issue(Tx, Access, Event, Input.CustomerId, Input.Lines, Percent, null);
  });
}

export async function GetPurchase(Access: Access, Id: number) {
  const [Row] = await Db.select({ Purchase: Purchases })
    .from(Purchases)
    .innerJoin(Events, eq(Events.Id, Purchases.EventId))
    .where(and(eq(Purchases.Id, Id), eq(Purchases.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Purchase not found");
  const Rows = await Db.select().from(Tickets).where(eq(Tickets.PurchaseId, Id)).orderBy(asc(Tickets.Id));
  return ShowPurchase(Row.Purchase, Rows);
}
