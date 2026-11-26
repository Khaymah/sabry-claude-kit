# Module boundaries

- **Situation:** creating a module, one module needing data or behaviour from another, deciding where shared code lives, a change in one feature breaking another.
- **Skip when:** a script or a single-file tool.
- **Decision:** a module exposes one public surface (its service functions and events, re-exported from `index.ts`); every other module goes through it. Dependencies point one way, and cycles are a bug.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small app, one developer; folders by feature are enough |
| Standard | Several modules that call each other; any production app |
| Advanced | Several developers or teams, or a module that may become its own service |

## Rules

### Minimum — always, never cut

- Folders by feature (`Modules/Orders`, `Modules/Users`), not by technical type (`controllers/`, `services/` at the root).
- A module never writes to another module's tables. Reading them through a join is allowed at Minimum.
- `Core/Utils` holds only what two or more modules already use; it never imports from a module.

### Standard — adds

- Each module has an `index.ts` that exports its public functions and types; other modules import only from it (`@/Modules/Users`, never `@/Modules/Users/Users.Service`).
- Cross-module reads go through the owner's service (`UsersService.GetPublicProfile(Id)`), not its tables.
- Side effects in another module (send email after order, update stock after payment) go through events (`EventBus.Emit("Orders.Paid", …)`), so the emitter does not import the listener.
- An enforced rule: a lint rule or a test that fails on deep imports and on cycles (`eslint-plugin-boundaries`, `dependency-cruiser`, or `madge --circular`).

### Advanced — adds

- Each module owns its schema (`Orders_*` tables or a Postgres schema per module) and no foreign key crosses modules; ids are copied, consistency by events.
- Events are versioned contracts (`Orders.Paid.v1`) with a typed payload in the emitter's public surface.
- `CODEOWNERS` per module folder.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Two modules need each other (Orders ↔ Inventory) | One depends on the other's service; the reverse direction becomes an event. Never both imports |
| Report or admin screen reading many modules | A read-only `Reporting` module may query several schemas; it never writes |
| Shared type (Money, Pagination) | Lives in `Core/Types`; a type owned by a module stays in that module and is exported from its `index.ts` |
| A transaction must span two modules | The owning module's service accepts the `Tx`; or redesign with an event plus an outbox at Advanced |
| A helper used by only one module "might be reused" | Stays inside that module until a second module needs it |

## Example — Standard, Bun + Hono

```ts
export { GetPublicProfile, GetById } from "./Users.Service"
export type { IPublicProfile } from "./Users.Types"
```

```ts
import { GetPublicProfile } from "@/Modules/Users"

EventBus.On("Orders.Paid", async ({ OrderId }) => InventoryService.CommitReservation(OrderId))
```

```json
{
  "forbidden": [
    { "name": "no-deep-module-imports", "from": { "path": "^Src/Modules/([^/]+)/" }, "to": { "path": "^Src/Modules/(?!$1)[^/]+/.+", "pathNot": "index\\.ts$" } },
    { "name": "no-circular", "from": {}, "to": { "circular": true } }
  ]
}
```

That last block is a `.dependency-cruiser.json` excerpt, run in CI with `bunx depcruise Src`.

Other stacks: Next.js features under `src/features/<name>` with the same `index.ts` rule; NestJS modules export providers explicitly, which already enforces it.

## Verify

- [ ] `[M]` No module writes another module's table (`grep` the module's `insert(`/`update(` targets).
- [ ] `[S]` `bunx depcruise Src` (or `madge --circular`) reports no deep imports and no cycles.
- [ ] `[S]` Deleting a listener of an event leaves the emitting module compiling.
- [ ] `[A]` No foreign key references a table owned by another module.

## Pitfalls

- **`Utils/` that imports from modules** → hidden cycles → utilities depend on nothing above `Core`.
- **Service calling another module's model directly** → schema changes break distant code → call its service.
- **Event for everything** → logic impossible to follow → events only for side effects in other modules; direct calls inside a module.

## Related

`architecture/modular-monolith.md` · `architecture/events-side-effects.md` · `Stacks/Bun-Hono.md` §Architecture
