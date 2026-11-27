# Time zones and day boundaries

- **Situation:** timestamps, "today", daily reports, due dates, expiry, birthdays, working hours, scheduled jobs, anything shown as a date or grouped per day.
- **Skip when:** the app never stores or shows a time (a pure calculator or static site).
- **Decision:** instants are stored as `timestamptz` (UTC on the wire, ISO 8601 with `Z`); a "day" is defined by the tenant's IANA zone (default `Africa/Cairo`), never by the server's or the browser's zone. Date-only facts are `date` columns, not midnight timestamps. A zone, format or storage rule the owner stated or the project already uses wins over the defaults here.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One country, no reports by day, few time fields |
| Standard | Reports per day/month, working hours, expiry, jobs at local times |
| Advanced | Tenants in several zones, DST zones, schedules that must survive zone rule changes |

## Rules

### Minimum — always, never cut

- Columns for instants are `timestamp with time zone`. Never `timestamp without time zone` for an instant, never a string, never local time stored as if it were UTC.
- Never mix SQL `now()` with application time in one flow. Pick one source per operation: the app reads the clock once through an injected `Now()` and passes it into every query and comparison.
- Never compute a day boundary with `setHours(0,0,0,0)`, `new Date().getDate()` or `toISOString().slice(0,10)`: they use the server zone or UTC and shift the day by up to 3 hours in Cairo.
- Parse input at the edge: a datetime without an offset is rejected (400) unless the field is documented as tenant-local; a `date` field is validated as `YYYY-MM-DD` and never converted to a timestamp.

### Standard — adds

- The tenant row holds `TimeZone text NOT NULL DEFAULT 'Africa/Cairo'`, validated against `Intl.supportedValuesOf("timeZone")`.
- "Per day" reports group by `("CreatedAt" AT TIME ZONE $tz)::date`, and range filters are half-open on instants: `>= StartOfDay(tz)` and `< StartOfNextDay(tz)`. Never `BETWEEN` with `23:59:59`.
- Facts about a calendar day (birthday, due date, holiday, invoice date) are `date`; a rule like "9:00 every Sunday" is a local `time` plus the zone, not an instant.
- Convert to the tenant zone only at the output edge (report, email, UI). The API sends UTC instants; the client formats with the viewer's locale.
- Tests inject `Now` and run with `TZ` set to a zone different from Cairo and from UTC, so a hidden dependence on the server zone fails.
- Scheduled jobs state their zone explicitly (`cron` with `tz`), see `backend/reliability/background-jobs.md`.

### Advanced — adds

- Store the IANA name, never an offset (`+02:00`) or abbreviation: offsets change with law, names do not.
- Future local events (a meeting at 09:00 next month) store local date + time + zone and derive the instant when needed, so a rule change moves the instant, not the intent.
- Nonexistent and ambiguous local times (spring gap, autumn overlap) resolve by one named rule in one function (default: gap moves forward, overlap takes the first).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Order at 00:30 Cairo on the 1st (21:30 UTC on the 31st) | Counts in the new month for the tenant's report; a UTC grouping would put it in the old month |
| Egypt DST (law reinstated 2023: +03:00 in summer, +02:00 in winter; rules can change again) | Never hardcode `+02:00`; use the IANA zone, so the day still has 23 or 25 hours twice a year |
| Input `2026-03-01T09:00:00` with no offset | 400 `TIME_OFFSET_REQUIRED` (default code), not silently read as server-local |
| Client sends `2026-03-01` for a timestamp field | 400; a date-only value is a different type |
| Birthday or due date stored as `date`, user travels | Value unchanged; never shifts by the viewer's zone |
| End-of-range filter `to=2026-03-31` | Includes the whole 31st: query `< 2026-04-01 00:00 tenant-local` |
| Server, DB and CI run in different zones | Same results: only `timestamptz`, injected `Now`, explicit zones |
| Old rows stored as local time in a `timestamp` column | Migrate with `AT TIME ZONE 'Africa/Cairo'` after confirming which zone wrote them, in a reviewed migration |
| `CreatedAt` set by app clock on one server and `now()` default on another | Rows out of order by clock skew; one source per table, prefer the DB default for audit fields and the injected clock for business rules |
| Data at 100×: per-day report over years of rows | Index `("TenantId", "CreatedAt")` and range filters on the raw column; wrapping the column in `AT TIME ZONE` in `WHERE` kills the index, so convert the bounds, group on the expression, or use a daily summary table |
| Twice / parallel: two jobs both compute "yesterday" at midnight | The window comes from one `Now` and the tenant zone; the job is idempotent per `(TenantId, Day)` (unique key), so the second run is a no-op |

## Example — Standard, Bun + Hono + Drizzle

```ts
export type TClock = { Now: () => Date }

export const SystemClock: TClock = { Now: () => new Date() }

export function DayBounds(Day: string, Zone: string) {
  const Start = sql<Date>`(${Day}::date)::timestamp AT TIME ZONE ${Zone}`
  const End = sql<Date>`((${Day}::date + 1))::timestamp AT TIME ZONE ${Zone}`
  return { Start, End }
}

export async function SalesPerDay(TenantId: string, From: string, To: string, Zone: string) {
  const { Start } = DayBounds(From, Zone)
  const { End } = DayBounds(To, Zone)
  const Day = sql<string>`(${Orders.CreatedAt} AT TIME ZONE ${Zone})::date`
  return db.select({ Day, TotalMinor: sum(Orders.TotalMinor) })
    .from(Orders)
    .where(and(eq(Orders.TenantId, TenantId), gte(Orders.CreatedAt, Start), lt(Orders.CreatedAt, End)))
    .groupBy(Day)
    .orderBy(Day)
}

export const TenantTimeZoneSchema = z.string().refine((V) => Intl.supportedValuesOf("timeZone").includes(V))

export const InstantSchema = z.string().datetime({ offset: true }).transform((V) => new Date(V))

export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
```

Services take `Clock: TClock` and call `Clock.Now()` once per operation; tests pass `{ Now: () => new Date("2026-03-31T21:30:00Z") }`.

Other stacks: Laravel stores UTC with `config('app.timezone') = 'UTC'` and converts with Carbon `->setTimezone($tenant)`; Python uses `zoneinfo` and aware datetimes only.

## Verify

- [ ] `[M]` `grep -rnE "setHours\(0|toISOString\(\)\.slice|getTimezoneOffset|[^a-zA-Z]now\(\)" src/` finds no day math or mixed clocks on business paths.
- [ ] `[M]` No instant column is `timestamp without time zone`.
- [ ] `[S]` With `TZ=America/New_York`, the suite passes; an order at 21:30Z on the 31st lands on the 1st in Cairo's report.
- [ ] `[S]` `to=2026-03-31` includes a row at 23:59:59 local.
- [ ] `[A]` A local event at a nonexistent hour resolves by the named rule and a test pins it.

## Pitfalls

- **`new Date("2026-03-01")` read as UTC midnight, shown in a negative zone** → the previous day → keep `date` as a string and never build a `Date` from it.
- **`BETWEEN '…00:00' AND '…23:59:59'`** → drops the last second and fractions → half-open range.
- **`now()` in SQL and `new Date()` in the app compared in one rule** → skew flips edge cases → one injected clock.
- **Hardcoding `+02:00` for Egypt** → one hour off in summer → IANA zone.
- **Wrapping the indexed column in `AT TIME ZONE` in `WHERE`** → full scan → convert the bounds instead.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/background-jobs.md` · `domains/booking/availability.md` · `Stacks/Database.md`
