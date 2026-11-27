import { and, eq } from "drizzle-orm";
import { Db, type Transaction } from "../../Database/Db";
import { Customers, Events, Holds } from "../../Database/Schema";
import { AppError } from "../../Lib/Response";
import { Now } from "../../Lib/Clock";
import { OrganizerScope, type Access } from "../Organizers/Organizers.Service";
import { FindSession, LockCategories, RequireOnSale, TakenSeats } from "../Events/Events.Service";

const HoldMinutes = 10;

type Executor = Transaction | typeof Db;
type HoldRow = typeof Holds.$inferSelect;

export function ShowHold(Hold: HoldRow) {
  const Status = Hold.Status === "Active" && Hold.ExpiresAt <= Now() ? "Expired" : Hold.Status;
  return {
    Id: Hold.Id,
    EventId: Hold.EventId,
    SessionId: Hold.SessionId,
    CategoryId: Hold.CategoryId,
    CustomerId: Hold.CustomerId,
    Quantity: Hold.Quantity,
    Status,
    ExpiresAt: Hold.ExpiresAt,
  };
}

export async function RequireCustomer(Executor: Executor, CompanyId: number, CustomerId: number) {
  const [Customer] = await Executor.select({ Id: Customers.Id })
    .from(Customers)
    .where(and(eq(Customers.Id, CustomerId), eq(Customers.CompanyId, CompanyId)));
  if (!Customer) throw new AppError(404, "NOT_FOUND", "Customer not found");
}

export async function FindHold(Executor: Executor, Access: Access, Id: number, Lock = false) {
  const Query = Executor.select({ Hold: Holds })
    .from(Holds)
    .innerJoin(Events, eq(Events.Id, Holds.EventId))
    .where(and(eq(Holds.Id, Id), eq(Holds.CompanyId, Access.CompanyId), OrganizerScope(Access, Events.OrganizerId)));
  const [Row] = Lock ? await Query.for("update", { of: Holds }) : await Query;
  if (!Row) throw new AppError(404, "NOT_FOUND", "Hold not found");
  return Row.Hold;
}

export async function CreateHold(Access: Access, Input: { SessionId: number; CategoryId: number; CustomerId: number; Quantity: number }) {
  return Db.transaction(async (Tx) => {
    await RequireCustomer(Tx, Access.CompanyId, Input.CustomerId);
    const { Session, Event } = await FindSession(Tx, Access, Input.SessionId);
    const Categories = await LockCategories(Tx, Event.Id, [Input.CategoryId]);
    RequireOnSale(Event, [Session]);
    const Taken = (await TakenSeats(Tx, Event.Id)).get(`${Session.Id}:${Input.CategoryId}`) ?? 0;
    if (Categories.get(Input.CategoryId)!.Capacity - Taken < Input.Quantity) throw new AppError(409, "SOLD_OUT", "Not enough seats");
    const At = Now();
    const [Hold] = await Tx.insert(Holds)
      .values({
        CompanyId: Access.CompanyId,
        EventId: Event.Id,
        SessionId: Session.Id,
        CategoryId: Input.CategoryId,
        CustomerId: Input.CustomerId,
        Quantity: Input.Quantity,
        ExpiresAt: new Date(At.getTime() + HoldMinutes * 60_000),
        CreatedAt: At,
      })
      .returning();
    return ShowHold(Hold);
  });
}

export async function GetHold(Access: Access, Id: number) {
  return ShowHold(await FindHold(Db, Access, Id));
}

export async function ReleaseHold(Access: Access, Id: number) {
  return Db.transaction(async (Tx) => {
    const Hold = await FindHold(Tx, Access, Id, true);
    if (ShowHold(Hold).Status !== "Active") throw new AppError(409, "INVALID_STATUS", "Hold is not active");
    const [Updated] = await Tx.update(Holds).set({ Status: "Released" }).where(eq(Holds.Id, Id)).returning();
    return ShowHold(Updated);
  });
}
