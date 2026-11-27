# Modular monolith

- **Situation:** starting a backend, choosing a folder layout, "monolith or microservices?", a codebase where every file imports every table.
- **Skip when:** the project already has a settled module structure (keep it and apply the boundary rules below inside it), or the app is a single-purpose script or worker.
- **Decision:** one deployable, one database, modules cut by business capability (Orders, Billing, Catalog), each owning its tables and exposing one public service. A module is split out only through `when-to-split-service.md`. A structure the owner stated or the project already uses wins over the folder names below.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small app, one developer, under ~10 tables: folders per capability, no cross-module table access |
| Standard | Several developers or 4+ capabilities: public service per module, import boundary enforced by lint |
| Advanced | Modules heading toward separate teams: per-module schema, events between modules, contract tests on the public service |

## Rules

### Minimum — always, never cut

- Cut modules by business capability (`Orders`, `Catalog`), never by technical layer at the top level (`controllers/`, `models/`).
- A table belongs to exactly one module. Only that module reads or writes it.
- Another module gets the data by calling the owner's public service function, never by importing its tables or repository.
- No cross-module joins in new code. Fetch ids from the owner, then query your own tables with them. Existing joins stay until touched; do not copy them.
- Every module still applies the tenant filter on its own queries (`backend/data/multi-tenancy.md`); crossing a module never drops it.

### Standard — adds

- Each module has an `index.ts` that exports only its public service and DTO types; imports from another module's inner files are a lint error (`no-restricted-imports`, or `dependency-cruiser`).
- Dependencies point one way. If A calls B and B calls A, extract the shared part or switch one direction to an event (`events-side-effects.md`).
- Public service functions take and return plain DTOs (ids, strings, minor-unit integers), never ORM rows or table types.
- Shared code (`Shared/`) holds only technical helpers (errors, db client, logger, Zod primitives), never business rules. A business rule used by two modules belongs to one of them.
- A reporting read that truly needs several modules' data goes through a dedicated read model or a query service that composes public services; not a join across owned tables.

### Advanced — adds

- One Postgres schema per module (`orders.*`, `billing.*`) and a database role per module with grants only on its own schema, so a forbidden join fails at the database.
- Modules talk by events when the caller does not need the answer now; a synchronous call stays only when the caller needs the result to continue.
- Contract test per public service, so a module can later be moved behind HTTP without changing callers.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Orders needs the customer's name for a list screen | Orders stores the snapshot it needs at purchase time, or calls `Customers.GetNames(Ids)` once per page; never a join into the customers table |
| A report needs data from five modules | Read model or composing query service; not a five-way join over owned tables |
| Module A and B each call the other | Direction cycle: extract the shared piece, or make one side an event; never a lazy import that hides the cycle |
| A second team starts owning a module | Add the lint boundary and contract tests first; physical split only if `when-to-split-service.md` triggers |
| One module becomes slow | Optimize inside the module (index, cache, job); a slow module alone is not a reason to split |
| An old query joins two modules' tables | Leave it, add it to the debt list; the next change to either side replaces the join with a public service call |
| Data at 100×: the owner's list function is called per row by another module | The public service has a batch form (`GetByIds(Ids)`); callers never loop one id at a time |
| Twice / parallel: two modules update their own tables for one business action | Not one transaction by default: the initiator commits and publishes an event; both-or-neither needs a single owning module or an explicit shared transaction decision |

## Example — Standard, Bun + Hono + Drizzle

```
src/
  Modules/
    Orders/
      index.ts
      OrdersService.ts
      OrdersRepository.ts
      OrdersRoutes.ts
      OrdersSchema.ts
      OrdersTypes.ts
    Catalog/
      index.ts
      CatalogService.ts
      CatalogRepository.ts
      CatalogRoutes.ts
      CatalogSchema.ts
  Shared/
    Db.ts
    Errors.ts
    Logger.ts
  App.ts
  Server.ts
```

```ts
export { OrdersService } from "./OrdersService"
export type { TOrderDto, TCreateOrderInput } from "./OrdersTypes"
```

```ts
import { CatalogService } from "../Catalog"

export const OrdersService = {
  async Create(TenantId: string, Input: TCreateOrderInput): Promise<TOrderDto> {
    const Prices = await CatalogService.GetPricesByIds(TenantId, Input.Lines.map((L) => L.ProductId))
    return OrdersRepository.InsertWithLines(TenantId, Input, Prices)
  },
}
```

```ts
const App = new Hono()
App.route("/orders", OrdersRoutes)
App.route("/products", CatalogRoutes)
export default App
```

Lint rule: `no-restricted-imports` with pattern `**/Modules/*/!(index)*` outside the module itself.

Other stacks: NestJS modules with `exports` of the service only; Laravel packages or `app/Modules/<Name>`; same rule, the public surface is one service.

## Verify

- [ ] `[M]` `grep -rn "from \"../Catalog/" src/Modules/Orders` finds nothing except the `../Catalog` index import.
- [ ] `[M]` No new query joins a table owned by another module.
- [ ] `[S]` Lint fails when a module imports another module's repository.
- [ ] `[S]` `dependency-cruiser` reports no cycle between modules.
- [ ] `[A]` Connecting as the Orders database role and selecting from a Billing table is denied.

## Pitfalls

- **`Shared/` becomes the dumping ground** → hidden coupling through shared business code → only technical helpers there.
- **Public service returns ORM rows** → callers depend on another module's columns → return DTOs.
- **One shared `Types` file with every table** → every module imports every table → types live inside their module.
- **Splitting early "for microservices"** → distributed transactions and deploy cost with no gain → modules first, split by trigger.

## Related

`architecture/layering.md` · `architecture/events-side-effects.md` · `architecture/when-to-split-service.md` · `backend/data/multi-tenancy.md` · `quality/maintainability/module-boundaries.md`
