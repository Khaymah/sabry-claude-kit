# Test strategy

- **Situation:** "what should I test?", "how many tests?", a new project's test setup, a bug that came back, coverage targets, a client asking about quality.
- **Skip when:** a throwaway spike that will be deleted; say so in the report.
- **Decision:** most confidence per minute comes from **integration tests** of each endpoint and job against a real database; unit tests only for pure logic with many branches (pricing, permissions, parsing); a handful of end-to-end tests for the journeys that make money. Tests assert behaviour through public surfaces, never private functions.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Prototype or internal tool: tests on money, security and parsing only |
| Standard | Production: every endpoint and job has an integration test; CI blocks on red |
| Advanced | SLA, many contributors: concurrency, contract and load tests; flaky tests tracked |

## Rules

### Minimum — always, never cut

- Every new branch that touches money, permissions, authentication or parsing of outside input has a test (owner rule).
- Every bug fix starts with a failing test that reproduces it.
- The suite is green before "done"; a red test is never skipped, deleted or loosened to pass.
- Tests are deterministic: time comes from a `Now` parameter or a fake clock, randomness from a seed, no real network.

### Standard — adds

- Each endpoint: one test for the happy path, one for its main failure (validation or permission), one for its business rule; through the HTTP layer (`App.request` in Hono, `supertest` in Express).
- Each background job: one test that runs it against the database and checks the outcome and its idempotency (run twice → same result).
- Pure rule tables (pricing, eligibility, state transitions): one unit test per row, generated from the table.
- Mock only what we don't own and can't run: payment providers, SMS, email, LLM APIs, at the adapter boundary (`quality/maintainability/solid-pragmatic.md`). Never mock the database or our own services.
- CI runs typecheck, lint and tests on every push; merge is blocked on red.
- Suite time budget: under 2 minutes locally; slow tests are made faster, not skipped.

### Advanced — adds

- Concurrency tests for every race-prone write (`quality/testability/concurrency-tests.md`).
- Contract tests for public APIs (schema snapshot or Pact) and shared adapter suites.
- Load test of the top journeys before launch and before big releases (k6).
- Flaky tests quarantined with an owner and a fix date, never silently retried forever.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Legacy code with no tests | Characterization tests around what you will change, not a coverage campaign |
| Code that calls the clock (`new Date()`) | `Now` injected as a parameter with a default; tests pass a fixed date |
| Code that depends on a third-party API | A fake adapter implementing the port; one optional live smoke test outside CI |
| A coverage target from the client | Report coverage of critical paths (money, auth) by name, not a global percentage |
| A test needs the order of other tests | Fixed: each test creates its own data (`quality/testability/test-data.md`) |
| 100×: the suite grows to 2,000 tests | Files run in parallel, each on its own database; slowest 10 tests reviewed monthly |
| Twice / parallel: two CI runs on the same branch at once | Each run uses its own database name; no shared state outside the runner |

## Example — Standard, Bun + Hono

The sample uses the owner's default statuses, shape and wire types; assert the project's own.

```ts
import { describe, expect, test } from "bun:test"

describe("POST /api/v1/orders", () => {
  test("creates an order with the catalog price", async () => {
    const { User, Token } = await CreateSignedInUser()
    const Product = await CreateProduct({ PriceMinor: 15_000n })
    const Res = await App.request("/api/v1/orders", {
      method: "POST",
      headers: { Authorization: `Bearer ${Token}`, "Idempotency-Key": crypto.randomUUID(), "Content-Type": "application/json" },
      body: JSON.stringify({ Items: [{ ProductId: Product.Id, Quantity: 2 }] }),
    })
    expect(Res.status).toBe(201)
    const Body = await Res.json()
    expect(Body.Data.TotalMinor).toBe("30000")
    expect(Body.Data.CustomerId).toBe(User.Id)
  })

  test("rejects a quantity above the limit", async () => {
    const { Token } = await CreateSignedInUser()
    const Res = await PostOrder(Token, { Items: [{ ProductId: crypto.randomUUID(), Quantity: 10_000 }] })
    expect(Res.status).toBe(400)
  })
})
```

Other stacks: Vitest + `supertest` for Express/Fastify; Next.js route handlers tested by calling the exported handler with a `Request`; Laravel feature tests with `RefreshDatabase`.

## Verify

- [ ] `[M]` Each money, auth and parsing branch added has a test that fails without the change.
- [ ] `[M]` `bun test` green; no `.skip` or `.only` committed (`grep -rn "\.only(\|\.skip(" Src/`).
- [ ] `[S]` Every route file has a matching integration test file.
- [ ] `[S]` CI blocks merge on red; suite under 2 minutes.
- [ ] `[A]` Concurrency and contract suites run in CI; flaky list is empty or owned.

## Pitfalls

- **Mocking the database** → tests pass, SQL fails in production → real Postgres.
- **Testing private functions** → every refactor breaks tests → test the public surface.
- **Coverage as the goal** → tests that execute code without asserting → assert outcomes on critical paths.

## Related

`quality/testability/integration-db.md` · `quality/testability/test-data.md` · `quality/testability/e2e.md` · `quality/maintainability/refactoring.md`
