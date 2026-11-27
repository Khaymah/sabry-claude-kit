# Availability and slots

- **Situation:** "show free times", working hours, staff schedules, rooms or resources, breaks, holidays, buffers between appointments, slot length, clinics, salons, courts, classes.
- **Skip when:** a hosted scheduler (Calendly, Cal.com) owns availability and we only embed it.
- **Decision:** availability is computed, not stored: weekly rules in the tenant's local zone, minus exceptions (holidays, leave) and existing bookings, expanded to UTC instants on read. Showing a slot is advisory; the booking write re-checks it (`domains/booking/double-booking.md`). Slot step, buffer and zone rules the owner stated or the project already uses win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One resource, fixed weekly hours, one duration |
| Standard | Several staff or resources, breaks, holidays, per-service duration and buffers |
| Advanced | Capacity above 1, multi-resource services (doctor + room), several zones, heavy read traffic |

## Rules

### Minimum — always, never cut

- Bookings store `StartsAt` and `EndsAt` as `timestamptz` UTC; working hours store local `time` plus the tenant zone (default `Africa/Cairo`, see `backend/data/time-zones.md`).
- Intervals are half-open `[start, end)`: a booking ending 10:00 does not conflict with one starting 10:00.
- Every availability query filters by `TenantId` and by the resource; a slot from one tenant never reveals another's bookings.
- Only `Held` (with `HoldExpiresAt > Now`) and `Confirmed` bookings block time; `Cancelled`, `Expired`, `NoShow` and `Completed` do not.
- Never offer a slot in the past or inside the minimum notice (default 1 hour); compare with the injected `Now`.

### Standard — adds

- Weekly rules: `Weekday` (0-6, the project's start of week; Egypt weeks often start Saturday, store the number and document it), `OpensAt`, `ClosesAt`, `ResourceId`. Breaks are separate rows, not a hole in the logic.
- Free time = rule intervals − holidays − leave − bookings (with buffers) − breaks, computed as interval subtraction, then cut into slots at the service's step (default 15 min) that fit `Duration + BufferAfter`.
- Buffers belong to the service, applied to the booking's occupied range (`OccupiedFrom = StartsAt - BufferBefore`, `OccupiedUntil = EndsAt + BufferAfter`); the customer sees `StartsAt` only.
- Holidays: official Egyptian holidays move yearly (lunar ones) so they are data rows per tenant, never hardcoded dates. Friday and weekly closures are rules, not holidays.
- Returned slots are UTC instants plus the resource id; the client formats them. Cap the query window (default 31 days) and reject larger ranges with 400.
- Slots for a range come from one query for bookings and one for rules, expanded in memory; never one query per day.

### Advanced — adds

- Capacity above 1: the slot's remaining places are `Capacity - SUM(Seats)` of overlapping bookings; hide the slot at 0.
- A service needing several resources is free only when every one is free in the same interval; intersect their free lists.
- Cache computed availability per `(TenantId, ResourceId, Day)` for seconds, and invalidate on any booking or rule change; a stale slot is acceptable because the write re-checks.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Service of 45 min, step 30, closing at 18:00 | Last start is 17:15 only if the step allows; otherwise 17:00; never a slot that ends after closing |
| Booking spans a break | Not offered; the break splits the free interval |
| Working rule 22:00-02:00 (crosses midnight) | Stored as two intervals on two weekdays; computed per local day, then converted |
| Egypt DST day (23 or 25 local hours) | Expand rules from local date + time per day; never add 24 h to an instant |
| Holiday added after bookings exist | Existing bookings stay and are flagged for the owner; they are not auto-cancelled |
| Rule changed (new hours) with future bookings outside them | Old bookings stay valid; only new slots follow the new rule |
| Customer's device in another zone | Slots are UTC instants; the tenant's local label is shown with the zone name |
| Staff deleted or deactivated | Their future free slots disappear; bookings are reassigned or cancelled by an explicit action |
| Data at 100×: 200 staff, 90-day window | One rules query and one bookings query per request, window capped, per-day cache; no loop of queries |
| Twice / parallel: two customers click the same slot | Both see it free; the booking write (exclusion constraint) lets one win and the second gets 409 with fresh slots |

## Example — Standard, Bun + Hono + Drizzle

```ts
export type TInterval = { From: number; To: number }

export function Subtract(Free: TInterval[], Busy: TInterval[]): TInterval[] {
  let Result = Free
  for (const B of [...Busy].sort((A, C) => A.From - C.From)) {
    Result = Result.flatMap((F) => {
      if (B.To <= F.From || B.From >= F.To) return [F]
      const Parts: TInterval[] = []
      if (B.From > F.From) Parts.push({ From: F.From, To: B.From })
      if (B.To < F.To) Parts.push({ From: B.To, To: F.To })
      return Parts
    })
  }
  return Result
}

export function CutSlots(Free: TInterval[], DurationMs: number, StepMs: number, NotBefore: number): number[] {
  const Starts: number[] = []
  for (const F of Free) {
    for (let S = Math.max(F.From, Math.ceil(NotBefore / StepMs) * StepMs); S + DurationMs <= F.To; S += StepMs) Starts.push(S)
  }
  return Starts
}

export async function BusyIntervals(TenantId: string, ResourceId: string, From: Date, To: Date, Now: Date) {
  const Rows = await db.select({ From: Bookings.OccupiedFrom, To: Bookings.OccupiedUntil })
    .from(Bookings)
    .where(and(eq(Bookings.TenantId, TenantId), eq(Bookings.ResourceId, ResourceId), or(eq(Bookings.Status, "Confirmed"), and(eq(Bookings.Status, "Held"), gt(Bookings.HoldExpiresAt, Now))), lt(Bookings.OccupiedFrom, To), gt(Bookings.OccupiedUntil, From)))
  return Rows.map((R) => ({ From: R.From.getTime(), To: R.To.getTime() }))
}
```

The step grid is aligned to the epoch, which matches local 15/30/60-minute grids because Cairo's offset is a whole hour; a zone with a 45-minute offset needs the grid aligned to the local day start. Expanding weekly rules into `TInterval[]` per local date uses the tenant zone helper from `backend/data/time-zones.md`.

Other stacks: the same interval subtraction works in SQL with `tstzmultirange` (`range_agg`, `-`) on PostgreSQL 14+.

## Verify

- [ ] `[M]` A booking ending 10:00 leaves 10:00 free; a slot in the past or inside the notice window is never returned.
- [ ] `[M]` Tenant B's bookings never change tenant A's slots (test with two tenants and one resource id collision).
- [ ] `[S]` A 45-minute service with a 15-minute buffer never starts a slot that ends after closing or overlaps a break.
- [ ] `[S]` A 31-day query issues two queries total, not one per day.
- [ ] `[A]` Capacity 4 with 3 booked shows 1 place; with 4 booked the slot disappears.

## Pitfalls

- **Adding `24 * 3600 * 1000` to step a day** → breaks on DST days → build each local date from its own date and zone.
- **Closed intervals `[start, end]`** → back-to-back bookings clash → half-open everywhere.
- **Storing generated slots as rows** → millions of rows and stale after every rule change → compute on read.
- **Hardcoding holiday dates** → wrong the next lunar year → data rows.
- **Treating the offered slot as reserved** → double booking → the write path re-checks.

## Related

`domains/booking/double-booking.md` · `backend/data/time-zones.md` · `backend/data/multi-tenancy.md` · `backend/data/concurrency.md`
