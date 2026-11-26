# Test data

- **Situation:** creating users, products and orders for tests; fixtures that break when the schema changes; seeds for demos and local development; tests that depend on each other's data.
- **Skip when:** pure unit tests on literals.
- **Decision:** factories, one per entity, that create valid rows with sensible defaults and accept overrides; each test names only the fields it cares about. Seeds for local and demo use are separate from tests and from migrations.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few factory functions for the main entities |
| Standard | A factory for every entity tests create; bulk variants |
| Advanced | Volume generators for performance and realistic demo data |

## Rules

### Minimum — always, never cut

- One factory per entity (`CreateUser`, `CreateProduct`, `CreateOrder`) in `Test/Factories/`, inserting through the database layer and returning the row.
- Defaults are valid and unique: emails and slugs carry a random suffix (`user-${Id}@test.local`), so tests never collide.
- A test overrides only what it asserts on (`CreateProduct({ Stock: 0 })`); everything else is the factory's business.
- No production data in tests or seeds; no real emails, phones or names.

### Standard — adds

- Related entities are created by the factory when not given (`CreateOrder()` creates its customer and product), and reused when given.
- Bulk factories (`CreateUsers(20)`) use one multi-row insert.
- Money in minor units as `bigint`; dates fixed or relative to an injected `Now`.
- A signed-in helper (`CreateSignedInUser()`) returns the user and a valid token without going through the sign-in endpoint.
- Seeds (`bun run seed`) are idempotent upserts for local development and demos, never run in production, never imported by tests.

### Advanced — adds

- A volume generator (`bun run seed:volume --orders 1000000`) for performance work, using `COPY` and realistic distributions (a few big customers, many small).
- Anonymised production snapshots only through a scrub script that is itself tested, and only when a bug cannot be reproduced otherwise.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Schema adds a required column | Only the factory changes; tests stay untouched |
| Arabic and long text | Factories have a variant with Arabic names and max-length strings, used by validation and RTL tests |
| Soft-deleted rows | `CreateUser({ IsDeleted: true })` exists so filters are tested |
| Time-dependent data (expired tokens, overdue invoices) | Created with dates relative to the test's `Now`, never `new Date()` at import time |
| Unique constraint in a factory default | Random suffix per call; never a fixed value |
| 100×: a test needs 10,000 rows | The bulk factory in chunks of 1,000, not a loop of single inserts |
| Twice / parallel: two tests create "the admin" | Each creates its own admin; no global singleton user |

## Example — Standard, Bun + Drizzle

```ts
let Seq = 0
const Unique = () => `${Date.now().toString(36)}${(Seq++).toString(36)}`

export async function CreateUser(Over: Partial<typeof Users.$inferInsert> = {}) {
  const Key = Unique()
  const [Row] = await db.insert(Users).values({
    Name: `User ${Key}`,
    Email: `user-${Key}@test.local`,
    PasswordHash: TEST_PASSWORD_HASH,
    IsActive: true,
    ...Over,
  }).returning()
  return Row
}

export async function CreateOrder(Over: Partial<typeof Orders.$inferInsert> & { Customer?: TUser } = {}) {
  const Customer = Over.Customer ?? (await CreateUser())
  const [Row] = await db.insert(Orders).values({
    CustomerId: Customer.Id,
    Currency: "EGP",
    SubtotalMinor: 10_000n,
    DiscountMinor: 0n,
    TaxMinor: 1_400n,
    TotalMinor: 11_400n,
    ...Over,
  }).returning()
  return Row
}
```

`TEST_PASSWORD_HASH` is computed once per run with `Bun.password.hash`, so factories don't pay the hashing cost per user.

Other stacks: `@faker-js/faker` for realistic values where they matter; Laravel model factories; Prisma with the same function pattern.

## Verify

- [ ] `[M]` No test inserts rows with raw SQL or literal ids; all go through factories.
- [ ] `[M]` Running any single test file alone passes (no hidden dependency on other files).
- [ ] `[S]` Adding a required column changed only the factory.
- [ ] `[S]` `grep -rn "@gmail\|@yahoo\|01[0-9]\{9\}" Test/` finds no real-looking personal data.
- [ ] `[A]` Volume generator produces the target size in minutes, not hours.

## Pitfalls

- **Shared JSON fixtures** → every schema change breaks dozens of tests → factories.
- **Fixed emails in factories** → unique violations in parallel runs → random suffix.
- **Seeds inside migrations** → demo data in production → separate seed command.

## Related

`quality/testability/integration-db.md` · `quality/testability/test-strategy.md` · `quality/testability/concurrency-tests.md`
