# Event loop and CPU

- **Situation:** one slow request makes every request slow, heavy computation (PDF, Excel, images, hashing, big JSON), algorithm choices over lists, regexes on user input, Node/Bun under load.
- **Skip when:** the work is bounded and tiny (a few hundred items, simple maps).
- **Decision:** nothing synchronous and heavy runs on the request thread: algorithms over user-sized data are O(n) or O(n log n) with `Map`/`Set` lookups, CPU-heavy work goes to a job or a worker, and every regex on untrusted input is linear-time and length-capped.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every Node / Bun server (one thread serves everyone) |
| Standard | Production with concurrent users |
| Advanced | CPU-heavy features, high request rates |

## Rules

### Minimum — always, never cut

- No `*Sync` APIs on request paths (`readFileSync`, `pbkdf2Sync`, `execSync`, `bcrypt.hashSync`); use the async ones. `Bun.password.hash` is async and correct.
- No nested scans over lists: `A.map(X => B.find(Y => Y.Id === X.Id))` is O(n×m); build `new Map(B.map(Y => [Y.Id, Y]))` once. `includes` inside a loop becomes a `Set`.
- Input sizes are capped before work starts (body limit, array length in the Zod schema, string `.max()`), so cost per request is bounded.
- Regexes applied to user input have no nested quantifiers (`(a+)+`, `(.*)*`, `(\w+\s?)*`) and run on length-capped strings.

### Standard — adds

- CPU work above ~50 ms (PDF generation, Excel parsing, image processing, large report aggregation) runs in a background job, or in a `Worker` when the response must wait for it.
- Large JSON: no `JSON.parse` / `JSON.stringify` of multi-MB payloads per request; paginate or stream.
- Sorting, grouping and aggregation of large sets happen in SQL, not in JS.
- PM2 cluster mode (or one process per core behind Nginx) so one busy process doesn't stall the whole service.
- Event-loop lag measured (a timer drift check) and logged when above 100 ms.

### Advanced — adds

- CPU profiling of hot endpoints under load (`bun --cpu-prof` or `node --cpu-prof`, flame graph) before optimising code by guesswork.
- A worker pool (`piscina` on Node, a fixed set of Bun `Worker`s) sized to cores − 1 for CPU features.
- Precomputation: expensive derived data computed on write or by a job, read cheaply.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User submits an array of 100,000 ids | Rejected by schema (`.max(500)`), not processed |
| Regex email validation on a 1 MB string | Length capped first (`.max(254)`); a linear validator |
| Password hashing under a sign-in flood | Async hashing plus rate limiting; the event loop stays free |
| Generating a 200-page PDF on request | Job + "we'll email it" or a progress endpoint |
| `Array.prototype.sort` on 1M items in a job | Fine in a job; never in a request handler |
| Deep recursion on user-provided nested JSON | Depth limit in validation |

## Example — Standard, TypeScript

```ts
export function AttachCustomers(Orders: IOrder[], Customers: ICustomer[]) {
  const ById = new Map(Customers.map((C) => [C.Id, C]))
  return Orders.map((O) => ({ ...O, Customer: ById.get(O.CustomerId) ?? null }))
}

export const BulkTagSchema = z.object({
  Ids: z.array(z.string().uuid()).min(1).max(500),
  Tag: z.string().trim().min(1).max(50),
})

let Last = performance.now()
setInterval(() => {
  const Lag = performance.now() - Last - 1_000
  if (Lag > 100) Logger.warn({ LagMs: Math.round(Lag) }, "event loop lag")
  Last = performance.now()
}, 1_000).unref()
```

`setInterval` here is a monitor, not scheduled work; scheduled work belongs in the job system.

## Verify

- [ ] `[M]` `grep -rnE "Sync\(" Src/ --include=*.ts` finds nothing on request paths.
- [ ] `[M]` No `.find(` / `.filter(` / `.includes(` inside a `.map(` / `for` over another user-sized list.
- [ ] `[M]` Every array and string in request schemas has a `.max()`.
- [ ] `[M]` `eslint-plugin-regexp` rule `regexp/no-super-linear-backtracking` passes.
- [ ] `[S]` While a PDF export runs, a `/health` request still answers in < 50 ms.
- [ ] `[A]` Flame graph of the top endpoint reviewed; no single function above 30% that could be cached or moved.

## Pitfalls

- **Nested `.find` over two lists** → fine at 100 items, 10 s at 10,000 → `Map`.
- **Sync crypto or file reads in handlers** → the whole server pauses → async APIs.
- **Unbounded arrays in input** → one request can burn the CPU → `.max()` in the schema.

## Related

`quality/performance/memory.md` · `backend/reliability/background-jobs.md` · `quality/performance/profiling.md` · `quality/TRAPS.md`
