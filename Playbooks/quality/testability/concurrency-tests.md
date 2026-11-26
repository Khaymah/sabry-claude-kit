# Concurrency tests

- **Situation:** stock, seats, coupons, balances, wallets, "first come first served", unique usernames, double submits, webhooks delivered twice, anything two users or two retries can do at the same moment.
- **Skip when:** the write is naturally idempotent and has no invariant across rows (updating your own profile name).
- **Decision:** a race is tested, not reasoned about: fire N real requests at once against a real database, then assert the invariant (never negative, used once, exactly one row). The test runs several rounds, because one lucky pass proves nothing.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any feature that touches money or limited quantity |
| Standard | Every race-prone write in production |
| Advanced | High contention (flash sales, ticketing): load-level concurrency |

## Rules

### Minimum — always, never cut

- Each race-prone write has one test: N parallel requests (N ≥ 10) on the same resource, then the invariant is checked in the database, not in the responses.
- The test goes through the same path production does (HTTP handler or service), with real separate connections (pool size ≥ N), never inside one shared transaction.
- The fix the test proves is in the database: an atomic conditional update, `SELECT … FOR UPDATE`, or a unique constraint (`backend/data/concurrency.md`).

### Standard — adds

- 5 rounds per test, fresh data each round.
- Also test the "same request twice" race (double click, retry): with and without an idempotency key.
- Assert the responses too: exactly the expected number of successes, and the failures carry the business error code (`OUT_OF_STOCK`, `COUPON_USED`), never a 500 or a deadlock error.
- Deadlocks: if one appears, lock rows in a consistent order; the test must pass without retries.

### Advanced — adds

- Load-level runs (k6, 200+ virtual users on one hot resource) before a sale or launch, with the invariant checked after.
- `SERIALIZABLE` paths tested for their retry loop: forced serialization failures are retried and succeed.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Stock 5, 20 buyers at once | Exactly 5 succeed, 15 get `OUT_OF_STOCK`, stock is 0, never negative |
| Single-use coupon, 10 parallel checkouts | One redemption row, one success |
| Two sign-ups with the same email | One user; the other gets the "already registered" path, not a 500 |
| Wallet debit racing a credit | Final balance equals start + credit − debit; ledger sums match |
| Same webhook twice in parallel | Processed once (`backend/reliability/idempotency.md`) |
| 100×: 1,000 buyers on one product | The atomic update holds; p95 stays within budget; if not, queue the purchase |
| Twice / parallel: the test itself runs in parallel files | Each file has its own database and products, so rounds don't interfere |

## Example — Standard, Bun + Hono

```ts
import { expect, test } from "bun:test"

test("stock never oversells under 20 concurrent buyers", async () => {
  for (let Round = 0; Round < 5; Round++) {
    const Product = await CreateProduct({ Stock: 5 })
    const Buyers = await CreateSignedInUsers(20)
    const Results = await Promise.all(Buyers.map((B) => PostOrder(B.Token, { Items: [{ ProductId: Product.Id, Quantity: 1 }] })))
    const Statuses = Results.map((R) => R.status)
    expect(Statuses.filter((S) => S === 201)).toHaveLength(5)
    expect(Statuses.filter((S) => S === 409)).toHaveLength(15)
    const [Row] = await db.select({ Stock: Products.Stock }).from(Products).where(eq(Products.Id, Product.Id))
    expect(Row.Stock).toBe(0)
  }
})
```

`CreateSignedInUsers(20)` creates users in one bulk insert; the 20 requests share nothing but the product row. The `Promise.all` is intentional here: the parallelism is what the test measures.

## Verify

- [ ] `[M]` Every endpoint that decrements a quantity or balance has a concurrency test.
- [ ] `[M]` The test fails when the atomic update is replaced by read-then-write (try it once).
- [ ] `[S]` 5 rounds, no 500s, no deadlock errors in the logs.
- [ ] `[A]` k6 run at launch scale with the invariant checked afterwards.

## Pitfalls

- **One sequential "concurrency" test** → passes by luck → real parallel requests, several rounds.
- **Running all requests inside one transaction** → they serialize and the race disappears → separate connections.
- **Asserting only the HTTP responses** → oversell hidden by a lying response → check the database.

## Related

`backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `backend/data/money.md` · `quality/testability/integration-db.md`
