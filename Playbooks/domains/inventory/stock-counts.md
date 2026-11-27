# Stock Counts

- **Situation:** physical inventory, cycle counts, fixing differences between the system and the shelf, "جرد", variance report, counting while the shop keeps selling.
- **Skip when:** a one-off correction of a single product (use an `Adjustment` movement with a reason through `stock-ledger.md`).
- **Decision:** a count is a session that freezes a system-quantity snapshot per line, collects counted quantities, and on approval writes the variance as movements. Sales during the count are subtracted, so the adjustment equals real shelf difference.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small shop, counted when closed, one person enters the numbers |
| Standard | Counting while selling, approval before posting, variance report |
| Advanced | Multiple counters, blind counts, recount rules, cycle counting by value class |

## Rules

### Minimum — always, never cut

- Posting a count writes `Count` movements through `MoveStock`; it never overwrites `StockLevels.Quantity` with the counted number.
- The counted quantity is a non-negative integer validated at the edge; empty is "not counted", never zero.
- A count belongs to one tenant and one branch; the user must hold that branch.
- Posting is a single transaction with a status guard `Open` → `Posted`; a second post is 409.

### Standard — adds

- On opening, per line: `SnapshotQuantity` (system quantity at `StartedAt`) and `StartedAt`. At posting, `Variance = Counted - (SnapshotQuantity + MovementsSinceStart)`, where `MovementsSinceStart = SUM("Delta")` for that branch and product with `CreatedAt >= StartedAt` and `Reason <> 'Count'`. The movement posted is `Variance`.
- Count one product at a time with its own timestamp (`CountedAt` per line) when counting spans hours; use `CountedAt`, not `StartedAt`, as the cut for that line.
- Statuses: `Open` → `Submitted` → `Approved` → `Posted`, or `Rejected`/`Cancelled`. Counter and approver are different users when the owner says so; checked on the server (`backend/auth/rbac.md`).
- Variances above an owner threshold (quantity or value) require approval; below it can auto-post.
- Variance report: per product, system vs counted vs variance, value at cost, reason code, who counted, who approved. Totals separate shortage from surplus; they never net out.
- Lines not counted stay untouched; the report lists them as "not counted".
- Reservations: a variance that pushes `Quantity` below `Reserved` is flagged for resolution, not posted silently (`domains/inventory/reservations.md`).
- Audit every state change (`backend/data/audit-log.md`).

### Advanced — adds

- Blind count: the counter never sees `SnapshotQuantity`; the API omits it for the counter's role.
- Recount: a variance above the threshold forces a second counter before approval; two matching counts win.
- Cycle counting: rotate classes (A items monthly, C items yearly); one open count per branch and product at a time.

## Edge cases

| Case | Expected behaviour |
|---|---|
| 3 sold between start and count of one product | Variance excludes them; system 10 at start, counted 6, sold 3 → expected 7, variance -1 |
| Goods received during the count | Added to expected; variance unaffected |
| Count submitted twice, or posted twice | Status guard; one set of movements |
| Product counted by two users in two sessions | Unique partial index: one open line per branch and product |
| Counted quantity `-5`, `2.5`, `"abc"`, `1e9` | 400 at the edge; upper bound from the owner's max |
| Approval after a long delay (3 days) | Variance is recomputed at posting from movements since `CountedAt`, never from a stale number |
| Count of a product with a transfer in transit | In-transit stock is not on the shelf and not in `Quantity`; excluded from the count |
| Negative system stock at start | Allowed to count; variance computed normally, flagged in the report |
| Count crosses midnight Cairo | Report date is the posting business date in `Africa/Cairo`; line timestamps are UTC |
| Data at 100× (200k lines in a branch count) | Lines created and posted in batches of 1,000; movements-since sums run in one grouped query, not per line |
| Twice / parallel: sale posted while the count posts | Both write relative movements; the count's variance uses a cut time, so neither overwrites the other |
| User of another branch opens the count by id | 404 |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function PostCount(Db: Db, Ctx: Ctx, CountId: string) {
  return Db.transaction(async (Tx) => {
    const Posted = await Tx.execute(sql`
      UPDATE "StockCounts" SET "Status" = 'Posted', "PostedAt" = now(), "PostedBy" = ${Ctx.UserId}
      WHERE "Id" = ${CountId} AND "TenantId" = ${Ctx.TenantId} AND "Status" = 'Approved'
        AND "BranchId" = ANY(${Ctx.BranchIds})
      RETURNING "BranchId"`)
    if (Posted.length === 0) throw new AppError("INVALID_STATE", 409)
    const BranchId = Posted[0].BranchId as string
    const Lines = await Tx.execute(sql`
      SELECT L."ProductId", L."CountedQuantity" - (L."SnapshotQuantity" + COALESCE(M."Moved", 0)) AS "Variance"
      FROM "StockCountLines" L
      LEFT JOIN LATERAL (
        SELECT SUM("Delta") AS "Moved" FROM "StockMovements"
        WHERE "TenantId" = ${Ctx.TenantId} AND "BranchId" = ${BranchId} AND "ProductId" = L."ProductId"
          AND "CreatedAt" >= L."CountedAt" AND "Reason" <> 'Count'
      ) M ON true
      WHERE L."CountId" = ${CountId} AND L."CountedQuantity" IS NOT NULL
      ORDER BY L."ProductId"`)
    for (const L of Lines) {
      if (Number(L.Variance) === 0) continue
      await MoveStock(Tx, { TenantId: Ctx.TenantId, BranchId, ProductId: L.ProductId as string, Delta: Number(L.Variance), Reason: "Count", ReferenceType: "StockCount", ReferenceId: CountId, UserId: Ctx.UserId })
    }
  })
}
```

Here `SnapshotQuantity` is the quantity taken at `CountedAt` for that line, so the join counts movements after it. When posting is hours after counting, `MoveStock` still guards against going negative.

Other stacks: a barcode-scanner app posts line by line; each scan updates `CountedQuantity` with `+1` relative, not the absolute screen value.

## Verify

- [ ] `[M]` Posting a count never changes `Quantity` except through movements; `SUM("Delta")` still equals `Quantity`.
- [ ] `[M]` Posting the same count twice gives 409 and one set of movements.
- [ ] `[S]` Sell 3 after counting started: variance excludes them.
- [ ] `[S]` A counter cannot approve their own count when the rule says so.
- [ ] `[A]` Blind count responses contain no system quantity for the counter's role.

## Pitfalls

- **Setting `Quantity` to the counted value** → every sale since the count began is lost → post the variance.
- **Treating empty as zero** → an uncounted shelf is zeroed → null means not counted.
- **Netting shortage against surplus** → real losses hidden → report both.
- **Variance computed once at count time** → approval days later is stale → recompute from the cut time.

## Related

`domains/inventory/stock-ledger.md` · `domains/inventory/reservations.md` · `backend/data/audit-log.md` · `backend/auth/rbac.md` · `backend/data/concurrency.md`
