import { and, eq, inArray, sql } from "drizzle-orm";
import { Db } from "../../Database/Db";
import { Events, OrganizerStaff, Organizers, Refunds, Tickets, Users } from "../../Database/Schema";
import type { AuthContext } from "../../Middleware/Auth";
import { AppError } from "../../Lib/Response";
import { FromPiasters, ToPiasters } from "../../Lib/Money";

export type Access = { CompanyId: number; OrganizerIds: number[] | null };

export async function ResolveAccess(Auth: AuthContext): Promise<Access> {
  if (Auth.Role === "Owner" || Auth.Role === "Admin") return { CompanyId: Auth.CompanyId, OrganizerIds: null };
  const Rows = await Db.select({ OrganizerId: OrganizerStaff.OrganizerId })
    .from(OrganizerStaff)
    .innerJoin(Organizers, eq(Organizers.Id, OrganizerStaff.OrganizerId))
    .where(and(eq(OrganizerStaff.UserId, Auth.UserId), eq(Organizers.CompanyId, Auth.CompanyId)));
  return { CompanyId: Auth.CompanyId, OrganizerIds: Rows.map((R) => R.OrganizerId) };
}

export function OrganizerScope(Access: Access, Column: typeof Events.OrganizerId | typeof Organizers.Id) {
  if (Access.OrganizerIds === null) return undefined;
  if (!Access.OrganizerIds.length) return sql`false`;
  return inArray(Column, Access.OrganizerIds);
}

export async function FindOrganizer(Access: Access, Id: number) {
  const [Row] = await Db.select()
    .from(Organizers)
    .where(and(eq(Organizers.Id, Id), eq(Organizers.CompanyId, Access.CompanyId), OrganizerScope(Access, Organizers.Id)));
  if (!Row) throw new AppError(404, "NOT_FOUND", "Organizer not found");
  return Row;
}

export async function CreateOrganizer(CompanyId: number, Name: string) {
  const [Row] = await Db.insert(Organizers).values({ CompanyId, Name }).returning();
  return { Id: Row.Id, Name: Row.Name };
}

export async function ListOrganizers(Access: Access) {
  return Db.select({ Id: Organizers.Id, Name: Organizers.Name })
    .from(Organizers)
    .where(and(eq(Organizers.CompanyId, Access.CompanyId), OrganizerScope(Access, Organizers.Id)))
    .orderBy(Organizers.Id);
}

export async function AssignStaff(Access: Access, OrganizerId: number, UserId: number) {
  await FindOrganizer(Access, OrganizerId);
  const [User] = await Db.select({ Id: Users.Id }).from(Users).where(and(eq(Users.Id, UserId), eq(Users.CompanyId, Access.CompanyId)));
  if (!User) throw new AppError(404, "NOT_FOUND", "User not found");
  await Db.insert(OrganizerStaff).values({ OrganizerId, UserId }).onConflictDoNothing();
  return { OrganizerId, UserId };
}

export async function RemoveStaff(Access: Access, OrganizerId: number, UserId: number) {
  await FindOrganizer(Access, OrganizerId);
  await Db.delete(OrganizerStaff).where(and(eq(OrganizerStaff.OrganizerId, OrganizerId), eq(OrganizerStaff.UserId, UserId)));
  return { OrganizerId, UserId, Removed: true };
}

const CairoDay = (Column: unknown) => sql`(${Column} AT TIME ZONE 'Africa/Cairo')::date`;

export async function Payout(Access: Access, OrganizerId: number, From: string, To: string) {
  await FindOrganizer(Access, OrganizerId);
  const [Sold] = await Db.select({
    Sales: sql<string>`coalesce(sum(${Tickets.Price}), 0)::text`,
    Fee: sql<string>`coalesce(sum(CASE WHEN ${Events.Status} = 'Cancelled' OR ${Tickets.Price} = 0 THEN 0
      ELSE least(${Tickets.Price}, floor(${Tickets.Price} * ${Events.FeePercent}) / 100 + ${Events.FeeFixed}) END), 0)::text`,
  })
    .from(Tickets)
    .innerJoin(Events, eq(Events.Id, Tickets.EventId))
    .where(
      and(
        eq(Events.CompanyId, Access.CompanyId),
        eq(Events.OrganizerId, OrganizerId),
        sql`${CairoDay(Tickets.CreatedAt)} BETWEEN ${From}::date AND ${To}::date`,
      ),
    );
  const [Back] = await Db.select({ Refunds: sql<string>`coalesce(sum(${Refunds.Amount}), 0)::text` })
    .from(Refunds)
    .innerJoin(Events, eq(Events.Id, Refunds.EventId))
    .where(
      and(
        eq(Events.CompanyId, Access.CompanyId),
        eq(Events.OrganizerId, OrganizerId),
        sql`${CairoDay(Refunds.CreatedAt)} BETWEEN ${From}::date AND ${To}::date`,
      ),
    );
  const Sales = ToPiasters(Number(Sold.Sales).toFixed(2));
  const Fee = ToPiasters(Number(Sold.Fee).toFixed(2));
  const RefundTotal = ToPiasters(Number(Back.Refunds).toFixed(2));
  return {
    OrganizerId,
    From,
    To,
    Sales: FromPiasters(Sales),
    Refunds: FromPiasters(RefundTotal),
    Fee: FromPiasters(Fee),
    Net: FromPiasters(Sales - RefundTotal - Fee),
  };
}
