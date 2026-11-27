import { and, asc, eq, sql } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, EventSessions, Events, Refunds, Tickets } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";
import { Now } from "../../Lib/Clock";
import { OrganizerScope, type Access } from "../Organizers/Organizers.Service";
import { FindSession } from "../Events/Events.Service";

type Executor = Transaction | typeof Db;
type TicketRow = typeof Tickets.$inferSelect;

const GateOpensBeforeMs = 3 * 60 * 60 * 1000;
const FullRefundBeforeMs = 48 * 60 * 60 * 1000;

export function NewTicketCode() {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase();
}

export function ShowTicket(T: TicketRow) {
  return {
    Id: T.Id,
    PurchaseId: T.PurchaseId,
    EventId: T.EventId,
    SessionId: T.SessionId,
    CategoryId: T.CategoryId,
    HolderCustomerId: T.HolderCustomerId,
    Price: T.Price,
    Code: T.Code,
    Status: T.Status,
  };
}

async function FindTicket(Executor: Executor, Access: Access, Id: number, Lock = false) {
  const Query = Executor.select({ Ticket: Tickets, StartsAt: EventSessions.StartsAt })
    .from(Tickets)
    .innerJoin(Events, eq(Events.Id, Tickets.EventId))
    .innerJoin(EventSessions, eq(EventSessions.Id, Tickets.SessionId))
    .where(and(eq(Tickets.Id, Id), eq(Tickets.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
  const [Row] = Lock ? await Query.for("update", { of: Tickets }) : await Query;
  if (!Row) throw new AppError(404, "NOT_FOUND", "Ticket not found");
  return Row;
}

export async function GetTicket(Access: Access, Id: number) {
  return ShowTicket((await FindTicket(Db, Access, Id)).Ticket);
}

export async function CheckIn(Access: Access, SessionId: number, Code: string) {
  return Db.transaction(async (Tx) => {
    const { Session, Event } = await FindSession(Tx, Access, SessionId);
    const [Ticket] = await Tx.select()
      .from(Tickets)
      .where(and(eq(Tickets.Code, Code), eq(Tickets.CompanyId, Access.CompanyId)))
      .for("update");
    if (!Ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found");
    if (Ticket.SessionId !== Session.Id) {
      if (Ticket.EventId !== Event.Id) await FindTicket(Tx, Access, Ticket.Id);
      throw new AppError(409, "WRONG_SESSION", "Ticket is for another session");
    }
    if (Ticket.Status !== "Valid") throw new AppError(409, "INVALID_STATUS", `Ticket is ${Ticket.Status}`);
    if (Event.Status !== "OnSale") throw new AppError(409, "EVENT_CANCELLED", "Event is cancelled");
    const At = Now();
    if (At.getTime() < Session.StartsAt.getTime() - GateOpensBeforeMs) throw new AppError(409, "GATE_CLOSED", "Gate is not open yet");
    await Tx.update(Tickets).set({ Status: "CheckedIn", CheckedInAt: At }).where(eq(Tickets.Id, Ticket.Id));
    return { TicketId: Ticket.Id, Status: "CheckedIn" };
  });
}

export async function RefundTicket(Access: Access, Id: number) {
  return Db.transaction(async (Tx) => {
    const { Ticket, StartsAt } = await FindTicket(Tx, Access, Id, true);
    if (Ticket.Status !== "Valid") throw new AppError(409, "INVALID_STATUS", `Ticket is ${Ticket.Status}`);
    const At = Now();
    const Left = StartsAt.getTime() - At.getTime();
    if (Left <= 0) throw new AppError(409, "SESSION_STARTED", "Session already started");
    const Paid = ToPiasters(Ticket.Price);
    const Amount = Left > FullRefundBeforeMs ? Paid : Math.floor((Paid * 50) / 100);
    await Tx.update(Tickets).set({ Status: "Refunded" }).where(eq(Tickets.Id, Id));
    await Tx.insert(Refunds).values({ CompanyId: Access.CompanyId, TicketId: Id, EventId: Ticket.EventId, Amount: FromPiasters(Amount), CreatedAt: At });
    return { TicketId: Id, Amount: FromPiasters(Amount), Status: "Refunded" };
  });
}

export function NormalizePhone(Raw: string) {
  const Compact = Raw.replace(/[\s\-().]/g, "");
  const Local = Compact.replace(/^(\+20|0020)/, "0");
  return /^01[0125]\d{8}$/.test(Local) ? Local : null;
}

const StoredPhoneKey = sql`regexp_replace(regexp_replace(coalesce(${Customers.Phone}, ''), '[\\s\\-().]', '', 'g'), '^(\\+20|0020)', '0')`;

export async function TransferTicket(Access: Access, Id: number, Input: { Name: string; Phone: string }) {
  const Phone = NormalizePhone(Input.Phone);
  if (!Phone) throw new AppError(400, "VALIDATION_ERROR", "Phone must be an Egyptian mobile number");
  return Db.transaction(async (Tx) => {
    const { Ticket } = await FindTicket(Tx, Access, Id, true);
    if (Ticket.Status !== "Valid") throw new AppError(409, "INVALID_STATUS", `Ticket is ${Ticket.Status}`);
    const [Existing] = await Tx.select({ Id: Customers.Id })
      .from(Customers)
      .where(and(eq(Customers.CompanyId, Access.CompanyId), sql`${StoredPhoneKey} = ${Phone}`))
      .orderBy(asc(Customers.Id))
      .limit(1);
    const HolderCustomerId = Existing
      ? Existing.Id
      : (await Tx.insert(Customers).values({ CompanyId: Access.CompanyId, Name: Input.Name, Phone }).returning({ Id: Customers.Id }))[0].Id;
    const [Updated] = await Tx.update(Tickets).set({ HolderCustomerId, Code: NewTicketCode() }).where(eq(Tickets.Id, Id)).returning();
    return ShowTicket(Updated);
  });
}
