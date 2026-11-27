# Layering

- **Situation:** "where does this code go", routes with 200 lines, business logic in handlers, queries scattered everywhere, controller/service/model arguments.
- **Skip when:** the project already has a layering (controllers/services/repositories, or use-cases). Keep it and apply only the "never in a route" and tenant rules to it.
- **Decision:** three layers. Route (parse, validate, authenticate, call, shape the response) → service (business rules, transactions, authorization of the action) → data access (queries only). Tenant scoping lives in one place, the data-access layer, fed by the tenant id from the auth context. The project's existing layering wins over these names.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any backend: no business logic in routes, no queries in routes |
| Standard | More than a handful of endpoints: service layer owns transactions, repository owns tenant filter |
| Advanced | Several entry points (HTTP, jobs, CLI) calling the same rules: services are transport-free and tested without HTTP |

## Rules

### Minimum — always, never cut

- A route does only: validate input (Zod), authenticate and check permission (`backend/auth/rbac.md`), call one service function, map the result to the response. No `if` about prices, status or stock.
- A route never imports the database client or a table.
- Input is validated at the edge before the service sees it; the service trusts its typed input but still enforces business rules.
- The tenant id comes from the verified auth context, never from the body, query or a path parameter alone.

### Standard — adds

- The service owns the transaction: one `db.transaction` per business action, opened in the service, and the repository functions take the transaction handle.
- The repository applies the tenant filter in one place (a helper that builds `WHERE TenantId = $1` plus soft-delete), so a new query cannot forget it (`backend/data/multi-tenancy.md`).
- Services throw typed errors (`AppError(Code, Status)`); one error middleware turns them into the response shape (`backend/api/error-format.md`). Services never build HTTP responses or know status codes beyond the error type.
- No network call (email, HTTP, payment) inside a database transaction; use `events-side-effects.md`.
- A repository function is a query, not a decision: no `if (status === ...)` business rules in it.
- A service calls other modules only through their public service (`modular-monolith.md`).

### Advanced — adds

- Services take a `Context` object (`TenantId`, `ActorId`, `RequestId`) as first argument, so jobs and CLI call them exactly like routes.
- Service tests run against a real test database without Hono; route tests only cover validation, auth and response shape.

## Edge cases

| Case | Expected behaviour |
|---|---|
| A job or CLI needs the same rule as an endpoint | It calls the service; if the logic sits in the route, move it into the service first |
| Two services need one query | One repository function in the owner module, reached through the owner's public service |
| A tiny CRUD endpoint with no rule | Route → service → repository still, even if the service is one line; the tenant and transaction rules stay in one place |
| Client sends `TenantId` in the body | Ignored or rejected; the auth context value is used |
| Admin acting on any tenant | An explicit, audited path with its own repository function, never a skipped filter (`backend/data/audit-log.md`) |
| Existing project mixes layers | Do not reorganize on the side; new code follows the rules, touched code moves one function at a time |
| Data at 100×: a list route loops a service call per row | The service has a batch function; N+1 lives in the service layer, so fix it there |
| Twice / parallel: the same service function runs from a route and a job at once | The rule is in the service and enforced by the database (`backend/data/concurrency.md`), not by the entry point |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const OrdersRoutes = new Hono<TAppEnv>()

OrdersRoutes.post("/", RequirePermission("orders:create"), zValidator("json", CreateOrderSchema), async (C) => {
  const Auth = C.get("Auth")
  const Order = await OrdersService.Create({ TenantId: Auth.TenantId, ActorId: Auth.UserId }, C.req.valid("json"))
  return C.json({ Data: Order }, 201)
})
```

```ts
export const OrdersService = {
  async Create(Ctx: TContext, Input: TCreateOrderInput) {
    const Prices = await CatalogService.GetPricesByIds(Ctx.TenantId, Input.Lines.map((L) => L.ProductId))
    const Order = await Db.transaction(async (Tx) => {
      await StockService.Reserve(Tx, Ctx.TenantId, Input.Lines)
      const Created = await OrdersRepository.Insert(Tx, Ctx.TenantId, Input, Prices)
      await OutboxRepository.Add(Tx, Ctx.TenantId, "OrderCreated", Created.Id, { OrderId: Created.Id })
      return Created
    })
    return Order
  },
}
```

```ts
const ForTenant = <T extends { TenantId: AnyPgColumn; IsDeleted: AnyPgColumn }>(Table: T, TenantId: string) =>
  and(eq(Table.TenantId, TenantId), eq(Table.IsDeleted, false))

export const OrdersRepository = {
  async GetById(Tx: TTx, TenantId: string, Id: string) {
    const [Row] = await Tx.select().from(Orders).where(and(ForTenant(Orders, TenantId), eq(Orders.Id, Id)))
    return Row ?? null
  },
}
```

Other stacks: NestJS controller/service/repository; Laravel controller → action/service → Eloquent scope (`GlobalScope` carries the tenant filter).

## Verify

- [ ] `[M]` `grep -rn "Db\|drizzle" src/**/*Routes.ts` finds no database import.
- [ ] `[M]` Sending another tenant's `TenantId` in the body changes nothing.
- [ ] `[S]` Every repository query goes through the tenant helper (grep for `.from(` without it).
- [ ] `[S]` A service error thrown mid-transaction rolls everything back and returns the standard error shape.
- [ ] `[A]` The same service function is called from a job in a test with no Hono import.

## Pitfalls

- **Fat route "just this once"** → logic duplicated in the job later → service first.
- **Transaction opened in the repository** → two repository calls cannot be atomic → the service owns it.
- **Tenant filter written by hand in each query** → one forgotten filter leaks data → one helper.
- **Services returning `Response` objects** → cannot reuse from jobs → typed errors and plain results.

## Related

`architecture/modular-monolith.md` · `architecture/events-side-effects.md` · `backend/data/multi-tenancy.md` · `backend/auth/rbac.md` · `backend/api/error-format.md` · `backend/data/concurrency.md`
