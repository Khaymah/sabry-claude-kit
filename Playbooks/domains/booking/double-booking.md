# Preventing double booking

- **Situation:** two customers book the same slot, same doctor, court, room or seat; limited-capacity classes; "hold the slot while paying"; overbooking complaints.
- **Skip when:** an external system is the single writer of bookings and we only mirror it.
- **Decision:** the database rejects overlap. A PostgreSQL exclusion constraint on `(ResourceId, tstzrange)` for capacity 1; an atomic conditional counter for capacity above 1; holds are rows with an expiry. Checking free slots in application code before inserting is never enough. Statuses, codes and hold length the owner stated or the project already uses win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Capacity 1 per resource, instant confirmation |
| Standard | Holds during payment, cancellation frees the slot, concurrency tests |
| Advanced | Capacity above 1, multi-resource services, high contention (launch day, popular class) |

## Rules

### Minimum — always, never cut

- Enable `btree_gist` and add `EXCLUDE USING gist ("ResourceId" WITH =, "TenantId" WITH =, tstzrange("OccupiedFrom", "OccupiedUntil", '[)') WITH &&) WHERE ("Status" IN ('Held','Confirmed'))`. Drizzle has no builder for it: put it in a hand-written migration.
- Insert and let the constraint decide. Catch SQLSTATE `23P01` (exclusion violation) and answer `409 SLOT_TAKEN` (default code) with fresh nearby slots; never a 500.
- Cancelled and expired rows are excluded by the `WHERE` of the constraint, so the slot frees by a status change alone.
- The booking's tenant, resource and customer ids come from the session and the server's lookups, never from the body, and the resource is verified to belong to the tenant.

### Standard — adds

- A hold is a booking with `Status = 'Held'` and `HoldExpiresAt`; default 10 minutes. It occupies the slot like a confirmed one. Payment confirmation moves it to `Confirmed` with `UPDATE … WHERE "Status" = 'Held' AND "HoldExpiresAt" > $now`.
- A job sets expired holds to `Expired` every minute (`backend/reliability/background-jobs.md`). Correctness must not depend on the job: a new insert treats a hold with `HoldExpiresAt <= now` as free by first expiring it in the same transaction (`UPDATE … SET "Status" = 'Expired' WHERE "ResourceId" = $1 AND "Status" = 'Held' AND "HoldExpiresAt" <= $now`).
- Create requests carry an `Idempotency-Key`, so a double tap or a retry returns the same booking (`backend/reliability/idempotency.md`).
- A concurrency test fires 20 parallel inserts for one slot and expects exactly one success (`quality/testability/concurrency-tests.md`).
- Reschedule is one `UPDATE` of the range on the same row, so the constraint checks the new range against others and the old range frees at the same moment; never cancel-then-insert in two transactions.

### Advanced — adds

- Capacity above 1: keep a `Slots` row per `(ResourceId, StartsAt)` with `Capacity` and `Taken`, and take seats with `UPDATE … SET "Taken" = "Taken" + $n WHERE "Id" = $1 AND "Taken" + $n <= "Capacity" RETURNING`; no row back means full. Release is the relative decrement in the same transaction as the status change. Add `CHECK ("Taken" BETWEEN 0 AND "Capacity")`.
- Multi-resource services (doctor + room): insert one occupancy row per resource in one transaction, ordered by `ResourceId`; any `23P01` rolls everything back.
- For a rush on one slot, queue the attempts per resource and process them in order instead of letting all of them fight for the same lock.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Two customers submit at the same millisecond | One insert commits, the other gets `23P01` → `409 SLOT_TAKEN` with alternatives |
| Back-to-back bookings 10:00-11:00 and 11:00-12:00 | Both allowed: the range is `[)` |
| Buffer after a booking | The constraint uses `OccupiedFrom/OccupiedUntil` (with buffers), so a booking inside the buffer is rejected |
| Hold expired but the job has not run | New insert expires it first, then succeeds; a payment arriving late finds `Expired` and is refunded or re-checked, never silently confirmed over someone else |
| Payment succeeded after the hold expired and the slot was re-taken | Confirm fails; the customer is refunded (`backend/data/money.md`) and told, never double-booked |
| Staff member reassigned after booking | The change is an `UPDATE` of `ResourceId`; the constraint validates the new resource |
| Old rows overlap (data from before the constraint) | The migration fails; list the conflicts, resolve them with the owner, then add the constraint; never `NOT VALID` and forget |
| Class of 10 seats, 3 customers book 4 seats each at once | The conditional increment lets two succeed (8 seats) and rejects the third |
| Customer books the same slot twice (double tap) | The idempotency key returns the first booking; without a key the second hits `23P01` against their own row, reported as 409 |
| Data at 100× bookings | The gist index on `(ResourceId, range)` keeps inserts and overlap checks logarithmic; partition by month or archive finished bookings so the index stays hot |
| Twice / parallel: confirm and expire run at the same time on one hold | Both are conditional `UPDATE … WHERE "Status" = 'Held'`; one wins, the other affects 0 rows and exits quietly |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function CreateBooking(Input: TCreateBooking, Clock: TClock) {
  const Now = Clock.Now()
  const Holds = Input.NeedsPayment
  try {
    return await db.transaction(async (Tx) => {
      await Tx.update(Bookings)
        .set({ Status: "Expired" })
        .where(and(eq(Bookings.TenantId, Input.TenantId), eq(Bookings.ResourceId, Input.ResourceId), eq(Bookings.Status, "Held"), lte(Bookings.HoldExpiresAt, Now)))
      const [Row] = await Tx.insert(Bookings).values({
        TenantId: Input.TenantId,
        ResourceId: Input.ResourceId,
        CustomerId: Input.CustomerId,
        StartsAt: Input.StartsAt,
        EndsAt: Input.EndsAt,
        OccupiedFrom: Input.OccupiedFrom,
        OccupiedUntil: Input.OccupiedUntil,
        Status: Holds ? "Held" : "Confirmed",
        HoldExpiresAt: Holds ? new Date(Now.getTime() + 10 * 60_000) : null,
      }).returning()
      return Row
    })
  } catch (Err) {
    if ((Err as { code?: string }).code === "23P01") throw new AppError("SLOT_TAKEN", 409)
    throw Err
  }
}

export async function ConfirmHold(TenantId: string, BookingId: string, Clock: TClock) {
  const [Row] = await db.update(Bookings)
    .set({ Status: "Confirmed", HoldExpiresAt: null })
    .where(and(eq(Bookings.TenantId, TenantId), eq(Bookings.Id, BookingId), eq(Bookings.Status, "Held"), gt(Bookings.HoldExpiresAt, Clock.Now())))
    .returning()
  if (!Row) throw new AppError("HOLD_EXPIRED", 409)
  return Row
}
```

The migration (hand-written SQL):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Bookings" ADD CONSTRAINT "BookingsNoOverlap"
  EXCLUDE USING gist ("TenantId" WITH =, "ResourceId" WITH =, tstzrange("OccupiedFrom", "OccupiedUntil", '[)') WITH &&)
  WHERE ("Status" IN ('Held', 'Confirmed'));
```

The expiry `UPDATE` and the insert share one transaction and the same clock value.

Other stacks: without PostgreSQL, lock the resource row (`SELECT … FOR UPDATE`), check overlap, insert, in one short transaction.

## Verify

- [ ] `[M]` 20 parallel inserts for one slot produce exactly one booking and 19 `409 SLOT_TAKEN`, repeated 5 rounds.
- [ ] `[M]` A booking ending at 11:00 and one starting at 11:00 both succeed.
- [ ] `[S]` An expired hold does not block a new booking even with the job stopped.
- [ ] `[S]` Confirming an expired hold returns 409 and does not change the row.
- [ ] `[A]` Capacity 10 with 30 parallel single-seat bookings yields 10 successes and `Taken = 10`.

## Pitfalls

- **`SELECT` overlap, then `INSERT`** → both pass under parallel requests → exclusion constraint.
- **Treating `23P01` as a server error** → 500 on a normal race → map to 409.
- **Relying only on the expiry job** → slots stay blocked or confirm late → expire inside the insert transaction.
- **Cancel then insert for reschedule** → a gap where someone else takes the slot → one `UPDATE`.
- **Constraint without the status filter** → cancelled bookings block the slot forever → partial `WHERE`.

## Related

`domains/booking/availability.md` · `domains/booking/cancellations.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/reliability/background-jobs.md` · `backend/data/multi-tenancy.md`
