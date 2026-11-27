# Recurring appointments and classes

- **Situation:** weekly sessions, "every Sunday 6pm", monthly checkups, classes with a schedule, series where one date moves or is cancelled, "edit this and all following".
- **Skip when:** every booking is a one-off; or a calendar provider owns recurrence and we sync its instances.
- **Decision:** store the rule (iCalendar `RRULE`, local start time, tenant zone) on a series row and materialize concrete occurrences as real booking rows for a rolling horizon (default 90 days). Edits to one date change that occurrence row; "this and following" splits the series. Every occurrence still goes through the double-booking write and stores UTC. The horizon and edit semantics the owner stated or the project already uses win over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Fixed weekly series, cancel one or all |
| Standard | Edit one vs this and following, exceptions, conflicts at creation, rolling horizon |
| Advanced | Monthly/complex rules, several zones, series with capacity and enrolment, huge series counts |

## Rules

### Minimum — always, never cut

- A series row holds `RRule`, `LocalStartTime`, `DurationMinutes`, `TimeZone` (default `Africa/Cairo`), `StartsOn` (`date`), `UntilOn` (`date`, nullable) and `TenantId`. Each occurrence is a `Bookings` row with `SeriesId`, `OccurrenceDate` (`date`) and UTC `StartsAt`/`EndsAt`, with `UNIQUE ("SeriesId", "OccurrenceDate")`.
- Always store UTC instants on occurrences. The local time lives on the series, because Egypt's DST law can change and a fixed `+02:00` would be wrong (see `backend/data/time-zones.md`).
- Every occurrence is created through the same insert that guards overlap (`domains/booking/double-booking.md`). A series is never created by a loop that skips the constraint.
- Creating a series is one transaction: if any occurrence conflicts, none is created and the response lists the conflicting dates (409), unless the owner chose "skip conflicts", in which case the response lists what was skipped.
- Never expand an unbounded rule in one request; cap generated occurrences per call (default 200) and the horizon.

### Standard — adds

- A job extends every open series to the horizon daily; it is idempotent through the unique `(SeriesId, OccurrenceDate)` with `ON CONFLICT DO NOTHING`, and a conflict with another booking is recorded as a skipped occurrence for the owner, never silently dropped.
- Edit one occurrence: update that row only and mark `IsException = true`, so regeneration never overwrites it. Cancel one: status `Cancelled` on that row, kept so the job does not recreate it.
- Edit this and following: set `UntilOn` of the old series to the day before, create a new series from the chosen date with the new rule, and move the future occurrences in one transaction; past occurrences are never touched.
- Edit all: only future, non-exception occurrences change; exceptions keep their edits unless the user confirms overriding them.
- Local time per occurrence is built from `OccurrenceDate + LocalStartTime` in the series zone and converted to UTC at generation; it is not derived by adding 7 days to the previous instant.
- Cancellation policy and refunds apply per occurrence (`domains/booking/cancellations.md`); cancelling the whole series cancels each future occurrence with its own window and refund row.
- Use a tested library for `RRULE` (`rrule`); never hand-write monthly or "last Friday" logic.

### Advanced — adds

- Enrolment in a class series is per occurrence (`Seats`), with a series-level subscription row that auto-enrols into each new occurrence if capacity allows.
- A rule change that crosses a zone rule change re-derives instants from local time for future occurrences only.
- Partition `Bookings` by month; the extension job runs per tenant in batches with an advisory lock per series.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Weekly 18:00 series across Egypt's DST switch | Local time stays 18:00; the UTC instant shifts by an hour on the switch date because it is built per date from the zone |
| Day 31 of a monthly rule in a 30-day month | The `RRULE` library skips it; the product rule (skip or last day) is decided with the owner and tested |
| One occurrence moved to another day, then "edit all" | The moved occurrence stays unless the user confirms overriding exceptions |
| "This and following" chosen on the first occurrence | Equivalent to editing the whole series; no empty old series is left behind |
| The new rule conflicts with an existing booking on one date | The whole edit is rejected with the date list, or that date is skipped by explicit choice |
| Resource deactivated mid-series | Future occurrences are flagged `NeedsReassignment`; nothing is cancelled automatically |
| Series with no end date | Only the rolling horizon exists as rows; reports count rows, not the rule |
| Data at 100×: 50,000 open series | The extension job reads only series whose `GeneratedUntil < horizon`, inserts in batches with `ON CONFLICT DO NOTHING`, and uses an index on `("TenantId", "GeneratedUntil")` |
| Twice / parallel: the extension job and a user edit run at the same moment | Series edits take `SELECT … FOR UPDATE` on the series row; the job does the same, so one waits; the unique key makes re-runs harmless |
| Old occurrences created before exceptions were tracked | Treated as non-exceptions; a migration compares them to the rule and marks differing rows `IsException = true` |

## Example — Standard, Bun + Hono + Drizzle

```ts
import { RRule } from "rrule"

export function OccurrenceDates(Series: TSeries, From: string, To: string): string[] {
  const Rule = new RRule({ ...RRule.parseString(Series.RRule), dtstart: new Date(`${Series.StartsOn}T00:00:00Z`) })
  const Last = Series.UntilOn && Series.UntilOn < To ? Series.UntilOn : To
  const Start = new Date(`${From}T00:00:00Z`)
  const End = new Date(Date.UTC(Number(Last.slice(0, 4)), Number(Last.slice(5, 7)) - 1, Number(Last.slice(8, 10)) + 1))
  return Rule.between(Start, End, true).map((D) => D.toISOString().slice(0, 10))
}

export function ToInstant(Date_: string, LocalTime: string, Zone: string): Date {
  return new Date(Temporal.ZonedDateTime.from(`${Date_}T${LocalTime}[${Zone}]`).epochMilliseconds)
}

export async function ExtendSeries(Tx: TTx, SeriesId: string, Horizon: string) {
  const [Series] = await Tx.select().from(BookingSeries).where(eq(BookingSeries.Id, SeriesId)).for("update")
  const Dates = OccurrenceDates(Series, Series.GeneratedUntil, Horizon).slice(0, 200)
  for (const Day of Dates) {
    const StartsAt = ToInstant(Day, Series.LocalStartTime, Series.TimeZone)
    const EndsAt = new Date(StartsAt.getTime() + Series.DurationMinutes * 60_000)
    try {
      await Tx.transaction((Sp) => Sp.insert(Bookings).values({ TenantId: Series.TenantId, SeriesId, OccurrenceDate: Day, ResourceId: Series.ResourceId, StartsAt, EndsAt, OccupiedFrom: StartsAt, OccupiedUntil: EndsAt, Status: "Confirmed" })
        .onConflictDoNothing({ target: [Bookings.SeriesId, Bookings.OccurrenceDate] }))
    } catch (E) {
      if (PgCode(E) !== "23P01") throw E
      await RecordSkipped(Tx, SeriesId, Day)
    }
  }
  const Reached = Dates.length < 200 ? Horizon : Dates[Dates.length - 1]
  await Tx.update(BookingSeries).set({ GeneratedUntil: Reached }).where(eq(BookingSeries.Id, SeriesId))
}
```

`ToInstant` uses the `Temporal` API (polyfill `@js-temporal/polyfill` on runtimes without it); Luxon `DateTime.fromISO(..., { zone })` is equivalent. The `RRULE` dates are treated as plain dates, never as instants. Each insert runs in its own savepoint (a nested `Tx.transaction`), so an overlap (`23P01`) rolls back only that insert: the date is recorded as skipped by `RecordSkipped`, or the whole series aborts, per the chosen mode. `GeneratedUntil` becomes the last date generated, not the horizon, when the 200 cap cut the batch, so no date is skipped. `OccurrenceDates` anchors the rule at `StartsOn`, includes the last day (`To` + 1 day, exclusive) and stops at `UntilOn`.

Other stacks: Python `dateutil.rrule` with `zoneinfo`; Java `ical4j` with `ZonedDateTime`.

## Verify

- [ ] `[M]` Creating a 12-week series stores 12 rows with UTC instants and the unique key; running the creation twice adds none.
- [ ] `[M]` One conflicting date aborts the series (or is listed as skipped by the chosen mode); no partial series without a report.
- [ ] `[S]` Across Egypt's DST switch the local start stays 18:00 while the UTC hour changes.
- [ ] `[S]` "This and following" leaves past occurrences untouched and does not duplicate the chosen date.
- [ ] `[S]` Running the extension job twice and in parallel with an edit creates no duplicates and no deadlock.
- [ ] `[A]` 50,000 series extend within the batch window with bounded memory.

## Pitfalls

- **Adding 7 days to the previous UTC instant** → drifts by an hour after a DST change → local date + time + zone per occurrence.
- **Materializing years at once** → millions of rows → rolling horizon.
- **Regenerating over edited rows** → loses exceptions → `IsException` and the unique key with `DO NOTHING`.
- **Storing the rule only and computing occurrences on read** → no overlap guard, no per-date cancellation or payment → real rows.
- **Hand-written "every last Friday"** → wrong in edge months → `RRULE` library.

## Related

`domains/booking/double-booking.md` · `domains/booking/availability.md` · `domains/booking/cancellations.md` · `backend/data/time-zones.md` · `backend/reliability/background-jobs.md`
