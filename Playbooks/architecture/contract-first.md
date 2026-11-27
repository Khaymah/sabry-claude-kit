# Contract first

- **Situation:** designing an API or schema before coding, frontend and backend drifting apart, shared types, "generate the docs", a mobile app consuming the API, breaking a client by renaming a field.
- **Skip when:** an internal script or a prototype with one consumer owned by the same developer and a single deploy.
- **Decision:** Zod schemas are the single contract. The same schemas validate requests, type the handlers, type the frontend client, and generate the OpenAPI document. A breaking-change check on the generated OpenAPI runs in CI. The project's existing contract tool (tRPC, OpenAPI-first, GraphQL) wins; apply the same principle with it.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any API with a web or mobile client: Zod at the edge, one schema per endpoint |
| Standard | Frontend in the same repo or a published client: shared types, generated OpenAPI |
| Advanced | Third-party or mobile clients you cannot force to update: breaking-change gate, versioning, deprecation window |

## Rules

### Minimum — always, never cut

- Every endpoint validates request body, query and params with a Zod schema at the edge, and the handler's types come from `z.infer`. No hand-written duplicate interface.
- Strip unknown keys on input (`z.object(...).strict()` for writes where an unexpected field is a client bug, default strip elsewhere); never pass a raw body to the database.
- Response shape is declared as a schema too, and the handler returns data that passes through it, so a leaked column (`PasswordHash`, `TenantId`) cannot appear by accident.
- Money is an integer in minor units, ids are the project's id type, dates are ISO 8601 UTC strings (defaults when the project has none, `backend/data/money.md`, `backend/data/time-zones.md`).

### Standard — adds

- Schemas live in a `Contracts/` package or folder imported by both backend and frontend; the frontend never re-declares a response type.
- The OpenAPI document is generated from the schemas (`@hono/zod-openapi`), served at `/openapi.json`, never written by hand.
- Adding an optional response field is non-breaking; removing, renaming, making an optional input required, narrowing an enum or changing a type is breaking.
- CI diffs the generated OpenAPI against the main branch (`oasdiff breaking`) and fails on a breaking change without a version bump or an explicit override label.
- Error responses are in the contract too (`backend/api/error-format.md`), so the client types its error codes.

### Advanced — adds

- A breaking change ships as a new version (`backend/api/versioning.md`); the old one stays for a stated window, with a `Deprecation` header and a usage metric.
- Consumer-driven contract tests for each external client or the mobile app's minimum supported version.
- Enums that clients switch on are open on the client side (an unknown value falls to a default branch), so adding a value is not a breaking change in practice.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Mobile app two versions behind sends the old shape | Still accepted until the deprecation window ends; metrics show who still calls it |
| Server adds a new enum value | Old clients get an unknown value; the contract says clients must handle it, tested on the client |
| Request has an extra unknown field | Stripped, or 400 for strict write schemas; never stored |
| An old row violates the new schema (null where now required) | The response schema fails in tests; migrate the data first, then tighten the contract |
| Large integer ids or `bigint` amounts | Sent as strings in JSON (`"15050"`) unless the project already sends numbers; the schema transforms both ways |
| Date-only field (`2026-11-27`) vs timestamp | Different schemas (`z.string().date()` vs `z.string().datetime()`); a date-only value is never shifted by a time zone |
| Data at 100×: the generated spec has 800 endpoints | Split per module spec files; the CI diff stays under a minute |
| Twice / parallel: two branches both change the same schema | CI diff runs against the merge target after rebase; the second to merge sees the breaking report |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const CreateOrderSchema = z.object({
  CustomerId: z.string().uuid(),
  Lines: z.array(z.object({ ProductId: z.string().uuid(), Quantity: z.number().int().min(1).max(1000) })).min(1).max(200),
})

export const OrderSchema = z.object({
  Id: z.string().uuid(),
  Status: z.enum(["Pending", "Paid", "Cancelled"]),
  TotalMinor: z.string().regex(/^\d+$/),
  Currency: z.string().length(3),
  CreatedAt: z.string().datetime(),
})

export type TCreateOrder = z.infer<typeof CreateOrderSchema>
export type TOrder = z.infer<typeof OrderSchema>
```

```ts
const CreateOrderRoute = createRoute({
  method: "post",
  path: "/orders",
  request: { body: { content: { "application/json": { schema: CreateOrderSchema } } } },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ Data: OrderSchema }) } } } },
})

OrdersRoutes.openapi(CreateOrderRoute, async (C) => {
  const Auth = C.get("Auth")
  const Order = await OrdersService.Create({ TenantId: Auth.TenantId, ActorId: Auth.UserId }, C.req.valid("json"))
  return C.json({ Data: OrderSchema.parse(Order) }, 201)
})

App.doc("/openapi.json", { openapi: "3.1.0", info: { title: "Api", version: "1.0.0" } })
```

CI step: `bunx oasdiff breaking main-openapi.json openapi.json --fail-on ERR`.

Other stacks: tRPC shares types without OpenAPI (add `trpc-openapi` for third parties); FastAPI generates OpenAPI from Pydantic models, same CI diff.

## Verify

- [ ] `[M]` A request with a wrong type or extra critical field gets 400 before any service code runs.
- [ ] `[M]` Adding a column to a table does not change any response until the response schema lists it.
- [ ] `[S]` Changing a Zod schema changes the frontend's compile result without editing a second file.
- [ ] `[S]` CI fails when a response field is removed from the schema.
- [ ] `[A]` The old API version still passes its contract tests during the deprecation window.

## Pitfalls

- **Returning the ORM row directly** → leaks internal columns, couples clients to the table → parse through the response schema.
- **Frontend types hand-copied** → silent drift → import from the shared contract.
- **Hand-written OpenAPI** → out of date within a month → generate it.
- **Tightening a schema before migrating data** → old rows fail responses in production → data first, contract second.

## Related

`backend/api/rest-design.md` · `backend/api/error-format.md` · `backend/api/versioning.md` · `backend/data/money.md` · `backend/data/time-zones.md` · `architecture/layering.md`
