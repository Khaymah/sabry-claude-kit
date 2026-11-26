# REST endpoint design

- **Situation:** adding an endpoint, naming routes, choosing methods and status codes, filters and sorting, actions that aren't CRUD, a frontend or mobile team asking "what does the API look like?".
- **Skip when:** the project uses GraphQL or tRPC end to end (`Stacks/GraphQL.md`).
- **Decision:** resource routes under `/api/v1/` in plural kebab-case, standard methods and status codes, one response shape (`Stacks/Bun-Hono.md` §Responses), every input validated by a Zod schema at the route, and the schema is the contract the docs and the frontend types come from.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Consistent routes, shape, statuses and validation |
| Standard | OpenAPI generated from the schemas, filter and sort allow-lists, typed client |
| Advanced | Public API: conditional requests, bulk endpoints, async operations, SDKs |

## Rules

### Minimum — always, never cut

- Routes: `/api/v1/<resources>` and `/api/v1/<resources>/:Id`, nouns, plural, kebab-case (`/api/v1/order-items`). Nesting one level at most (`/projects/:Id/tasks`).
- Methods: `GET` reads (never changes state), `POST` creates or runs an action, `PATCH` partial update, `PUT` full replace (rare), `DELETE` removes.
- Status codes: `200` OK · `201` created (with the resource) · `202` accepted for background work · `204` no body · `400` invalid input · `401` not signed in · `403` signed in, not allowed · `404` not found or not yours · `409` conflict with current state · `413` too large · `422` valid shape, impossible request (rare; prefer 409/400 consistently) · `429` rate-limited · `5xx` our fault.
- Every route validates params, query and body with Zod (`zValidator`) and reads only `c.req.valid(...)`; unknown fields are stripped.
- Responses use the shared shape; lists carry `Meta` (`backend/api/pagination.md`); money as strings in minor units; dates ISO 8601 UTC.

### Standard — adds

- Actions that aren't CRUD are sub-resources with `POST`: `/orders/:Id/cancel`, `/invoices/:Id/send`. No verbs in resource names.
- Filters and sorts are allow-listed in the query schema (`Status` enum, `Sort` in `["CreatedAt", "-CreatedAt", "Total"]`), each backed by an index.
- OpenAPI generated from the same Zod schemas (`@hono/zod-openapi`), served at `/api/docs` in non-production, and a typed client for the frontend (`hono/client` or `openapi-typescript`).
- `PATCH` uses the create schema's `.partial()` with at least one field required; server-owned fields (`Id`, `TenantId`, `CreatedAt`, `Status` transitions) are never writable through it.
- Long operations return `202` with a job id and a status URL.

### Advanced — adds

- `ETag` / `If-None-Match` for cacheable reads, `If-Match` for edits by API clients.
- Bulk endpoints (`POST /products/bulk`) with per-item results and limits.
- Webhooks out to customers signed with HMAC and retried with backoff.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Client sends a field the schema doesn't know (`IsAdmin: true`) | Stripped silently; never mass-assigned |
| Status transition through `PATCH { Status: "Paid" }` | Refused: transitions are actions (`/orders/:Id/pay`) with their own rules |
| Resource exists but is soft-deleted | `404` |
| Same filter param twice (`?Status=A&Status=B`) | Either supported as a list by the schema or `400`, never "last one wins" by accident |
| Very long query string | `414` from Nginx limit; filters that need more go in a `POST /search` |
| 100×: list endpoints under 100× traffic | Filters and sorts all hit indexes; page size capped; heavy lists cached |
| Twice / parallel: the same `POST` twice | Natural unique key or idempotency key (`backend/reliability/idempotency.md`) |

## Example — Standard, Bun + Hono

```ts
export const ListOrdersQuery = z.object({
  Status: z.enum(["Pending", "Paid", "Shipped", "Cancelled"]).optional(),
  Sort: z.enum(["CreatedAt", "-CreatedAt", "Total", "-Total"]).default("-CreatedAt"),
  Cursor: z.string().max(200).optional(),
  Limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const UpdateProductBody = CreateProductBody.pick({ Name: true, Description: true, PriceMinor: true })
  .partial()
  .refine((B) => Object.keys(B).length > 0, { message: "validation.empty_patch" })

OrdersRoutes.get("/", Auth, zValidator("query", ListOrdersQuery), OrdersController.List)
OrdersRoutes.get("/:Id", Auth, zValidator("param", z.object({ Id: z.string().uuid() })), OrdersController.Get)
OrdersRoutes.post("/", Auth, Idempotent, zValidator("json", CreateOrderBody), OrdersController.Create)
OrdersRoutes.post("/:Id/cancel", Auth, zValidator("param", IdParam), OrdersController.Cancel)
ProductsRoutes.patch("/:Id", Auth, Require("Products.Edit"), zValidator("param", IdParam), zValidator("json", UpdateProductBody), ProductsController.Update)
```

## Verify

- [ ] `[M]` Every route has a validator for each input it reads; no `c.req.json()` in controllers.
- [ ] `[M]` Posting an unknown field (`IsAdmin`) changes nothing.
- [ ] `[M]` Status codes match the table for create, not found, conflict, forbidden.
- [ ] `[S]` OpenAPI document builds and the frontend client type-checks against it.
- [ ] `[S]` Every allowed sort has an index (`EXPLAIN`).
- [ ] `[A]` `If-None-Match` with a current ETag returns 304.

## Pitfalls

- **`c.req.json()` passed straight to `insert`** → mass assignment → schema + `valid()`.
- **Verbs in routes (`/getOrders`, `/updateUser`)** → inconsistent API → resources + methods.
- **200 with `{ error }`** → clients can't rely on status codes → real codes.

## Related

`backend/api/pagination.md` · `backend/api/error-format.md` · `backend/api/versioning.md` · `Stacks/Bun-Hono.md` §Responses
