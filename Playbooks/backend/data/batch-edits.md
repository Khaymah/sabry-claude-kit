# All-or-nothing edits

- **Situation:** one request changes several rows: editing the lines of an order or invoice, a stocktake or stock adjustment with many products, a price list update, bulk status changes, saving a form with a table of items, "Save" that touches more than one record.
- **Skip when:** each row is independent and a partial result is acceptable and reported per row (a background import with an error report: `backend/files/import-export.md`).
- **Decision:** validate every line first, then apply all of them in one transaction, so the request either changes everything or nothing; a resubmit of the same request applies once.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Internal tool, few lines per request, one user editing |
| Standard | Orders, invoices or stock that customers or staff depend on |
| Advanced | Lines that move money or stock across documents, or hundreds of lines per request |

## Rules

### Minimum — always, never cut

- Parse and validate the whole payload before the first write: ids are integers in range (a 20-digit id is a `400`, never a `500`), quantities and prices within bounds, no duplicate line ids, every referenced row exists and belongs to the same tenant and document.
- One transaction for all writes of the request (`db.transaction(async (Tx) => …)`); any line that fails throws, and nothing is committed. No write happens before the last check.
- Errors name the line: `{ Code: "LINE_INVALID", Details: [{ Line: 3, Field: "Quantity", Code: "OUT_OF_RANGE" }] }`, all invalid lines at once, not only the first.
- Totals, stock and other derived values are recomputed inside the same transaction from the final lines, never adjusted line by line from values read before it started.

### Standard — adds

- Side effects that depend on the edit (stock movements, ledger rows, audit entries) are written in the same transaction; emails and webhooks go to an outbox read after commit.
- Rows the edit depends on are locked (`SELECT … FOR UPDATE`, ordered by `Id`) or changed with conditional updates, so two edits of the same document cannot interleave.
- A resubmit is safe: the request carries an idempotency key, or the document carries a `Version` checked in the `UPDATE` (`409 EDIT_CONFLICT` when someone saved in between).
- Payload size is capped (lines per request, body size) before parsing.

### Advanced — adds

- Large edits (hundreds of lines) use set-based statements (`INSERT … SELECT FROM unnest(...)`, one `UPDATE … FROM (VALUES …)`) instead of a query per line, still inside one transaction with a statement timeout.
- Every committed edit writes one audit entry with the before and after of each changed line.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Line 3 of 5 is invalid (unknown product, quantity below zero) | `400` naming line 3; lines 1, 2, 4 and 5 are not applied; stock and totals unchanged |
| A database error on the 4th write | The transaction rolls back; the response is an error and the document is exactly as before |
| Id `"99999999999999999999"` or `1e30` | `400` at validation; never a database overflow surfacing as `500` |
| The same line id twice in one payload | `400 DUPLICATE_LINE`, nothing applied |
| A line that points at another company's product | `404` or `400` like a missing row; nothing applied, nothing revealed |
| 100×: 2,000 lines in one request | Rejected over the cap, or applied with set-based statements in one transaction within the time budget |
| Twice / parallel: the user presses Save twice, or two staff save the same document | The resubmit applies once (idempotency key or version); the parallel save waits on the lock or gets `409`, never a mix of both |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function SaveOrderLines(CompanyId: number, OrderId: number, Input: TSaveLines) {
  const Lines = SaveLinesSchema.parse(Input).Lines
  if (new Set(Lines.map((L) => L.ProductId)).size !== Lines.length) throw new AppError("DUPLICATE_LINE", 400)
  return Db.transaction(async (Tx) => {
    const [Order] = await Tx.select().from(Orders)
      .where(and(eq(Orders.Id, OrderId), eq(Orders.CompanyId, CompanyId))).for("update")
    if (!Order) throw new AppError("ORDER_NOT_FOUND", 404)
    const Found = await Tx.select({ Id: Products.Id, Price: Products.Price }).from(Products)
      .where(and(eq(Products.CompanyId, CompanyId), inArray(Products.Id, Lines.map((L) => L.ProductId))))
    const PriceOf = new Map(Found.map((P) => [P.Id, P.Price]))
    const Bad = Lines.flatMap((L, I) => (PriceOf.has(L.ProductId) ? [] : [{ Line: I + 1, Code: "PRODUCT_NOT_FOUND" }]))
    if (Bad.length) throw new AppError("LINE_INVALID", 400, Bad)
    await Tx.delete(OrderLines).where(eq(OrderLines.OrderId, OrderId))
    await Tx.insert(OrderLines).values(Lines.map((L) => ({ OrderId, ProductId: L.ProductId, Quantity: L.Quantity,
      UnitPriceMinor: PriceOf.get(L.ProductId)! })))
    return RecalculateTotals(Tx, OrderId)
  })
}
```

`SaveLinesSchema` caps the line count and bounds every number (`z.number().int().positive().max(2_147_483_647)` for ids).

Other stacks: the same shape with the ORM's transaction; never let the framework auto-commit per statement.

## Verify

- [ ] `[M]` A payload whose 3rd line is invalid returns `400` naming line 3, and a read afterwards shows the document unchanged.
- [ ] `[M]` A 20-digit id returns `400`, not `500`.
- [ ] `[M]` A forced error on the last write leaves stock, totals and lines as before.
- [ ] `[S]` Two concurrent saves of the same document end in one consistent state; Save twice with the same key applies once.
- [ ] `[A]` 2,000 lines run in a constant number of statements.

## Pitfalls

- **Writing line by line and validating as you go** → the first lines are saved when the third fails → validate everything, then one transaction.
- **Stock adjusted per line from a value read before the transaction** → lost updates under concurrency → relative updates or locked rows inside the transaction.
- **`Number(id)` on user input** → huge ids overflow the column and surface as `500` → validate the range at the edge.

## Related

`backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/api/error-format.md` · `Stacks/Database.md`
