# SOLID, pragmatically

- **Situation:** "should this be an interface?", "add a repository layer?", dependency injection, a class or service growing many responsibilities, adding a second implementation of something (another payment provider, SMS gateway, storage).
- **Skip when:** the change is a small fix inside one function; SOLID is a design lens, not a checklist to apply to every edit.
- **Decision:** apply each principle only where it removes a real cost today: a second implementation, a test that cannot be written, a change that keeps touching unrelated code. An abstraction with one implementation and no test need is debt, not design.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Single developer, one implementation of everything |
| Standard | Several external providers, or code others will extend |
| Advanced | A platform with plugins or tenants supplying their own behaviour |

## What each principle means here

| Principle | Apply as | Don't |
|---|---|---|
| **S**ingle responsibility | One reason to change per file: Routes (HTTP shape), Controller (input → service → response), Service (business rules), Model (tables). A service that both prices and emails is two. | Split a 40-line function into five files "for SRP" |
| **O**pen/closed | A registry for variants that grow: `PaymentProviders["Paymob"]`, `Notifiers["Sms"]`. Adding one = adding an entry, not editing a `switch` in five places | Plugin systems for things with one variant |
| **L**iskov | Every provider adapter honours the same contract, including errors (`ProviderDeclined`, `ProviderUnavailable`) and units (minor units) | Adapters that throw provider-specific errors the caller must know |
| **I**nterface segregation | Small ports named after the caller's need: `IChargeCard`, not `IPaymentGatewayEverything` | One giant interface "for future providers" |
| **D**ependency inversion | Services depend on ports for **external** systems (payments, SMS, storage, LLMs, clock where time matters in tests) | A repository interface over Drizzle: the ORM already is the abstraction, and integration tests use a real database |

## Rules

### Minimum — always, never cut

- No interface, abstract class, factory or DI container with a single implementation and no test that needs it.
- Duplicate twice, abstract on the third occurrence, and only when the three really change together.
- Pass dependencies as function parameters or module imports; no DI framework in a Bun/Hono or Express app.

### Standard — adds

- Every external system sits behind a port in `Core/Ports/` (or the module's own folder) with one adapter per provider under `Adapters/`.
- Variant selection by registry keyed from `SystemSettings` (`Payments.ActiveProvider`), never by `if (provider === …)` scattered in services.
- Adapters map provider errors and units to the port's contract at the boundary.

### Advanced — adds

- Contract tests: one shared test suite runs against every adapter of a port.
- Tenant-specific behaviour through strategies resolved per request, with a default strategy and a feature flag per tenant.

## Edge cases

| Case | Expected behaviour |
|---|---|
| A second provider is "maybe next year" | No port yet; write the first adapter cleanly so extracting the port later is a rename |
| A test needs to fake the clock or randomness | Inject `Now()` / `RandomBytes()` as parameters with defaults; no global mocking |
| Two adapters cannot honour the same contract (one has refunds, one doesn't) | The port exposes the capability (`SupportsRefund`); callers check it, adapters don't throw "not implemented" |
| Existing codebase uses classes and DI (NestJS, .NET) | Follow it; the rule of no single-implementation interfaces still applies to new code |
| 100×: Twenty providers instead of two | The registry stays one map; adapters are imported lazily so boot time does not grow |
| Twice / parallel: The active provider setting changes while requests run | Each request resolves the provider once, at its start, from the settings snapshot |

## Example — Standard, Bun + Hono

```ts
export interface IChargeCard {
  Charge(Input: { AmountMinor: bigint; Currency: string; OrderId: string; IdempotencyKey: string }): Promise<{ ProviderRef: string }>
}

export const PaymentProviders: Record<string, IChargeCard> = {
  Paymob: PaymobAdapter,
  Stripe: StripeAdapter,
}

export function ActivePaymentProvider(): IChargeCard {
  const Name = GetSetting("Payments.ActiveProvider")
  const Provider = PaymentProviders[Name]
  if (!Provider) throw new AppError("PAYMENTS_PROVIDER_UNKNOWN", 500)
  return Provider
}

export async function PayOrder(OrderId: string, IdempotencyKey: string, Charge: IChargeCard = ActivePaymentProvider()) {
  const Order = await OrdersService.GetPayable(OrderId)
  return Charge.Charge({ AmountMinor: Order.TotalMinor, Currency: Order.Currency, OrderId, IdempotencyKey })
}
```

Other stacks: NestJS/.NET keep their DI container and register adapters under the port token; Laravel binds the port in a service provider.

## Verify

- [ ] `[M]` `grep -rn "^export interface I" src/` → each interface has two implementations or a test double that uses it.
- [ ] `[M]` No `class …Repository` wrapping ORM calls one-to-one.
- [ ] `[S]` Adding a provider changes the registry and one new adapter folder, nothing else (`git diff --stat`).
- [ ] `[S]` No `if (Provider === "…")` outside the registry.
- [ ] `[A]` The shared contract suite passes for every adapter.

## Pitfalls

- **Interface + impl + factory for one class** → three files to read for one behaviour → plain function until a second one exists.
- **Repository over the ORM** → leaky queries, double mapping, mocked tests that miss SQL bugs → use the ORM in services, test against Postgres.
- **"Manager" / "Helper" / "Utils" services** → no single reason to change → name by responsibility.

## Related

`quality/maintainability/module-boundaries.md` · `architecture/design-patterns.md` · `rules/smallest-change.md`
