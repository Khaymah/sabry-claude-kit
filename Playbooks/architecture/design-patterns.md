# Design patterns

- **Situation:** "should I use a strategy / adapter / repository / factory", interfaces with one implementation, provider integrations (payments, SMS, email), pricing or discount rules that keep growing `if` chains.
- **Skip when:** the code is a straight function with one path and no foreseeable second variant.
- **Decision:** a pattern earns its place only in the one case listed per pattern; everywhere else a plain function is the answer. The project's existing pattern use wins.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Plain functions and modules; adapters only at external providers |
| Standard | A rule set with several named variants (pricing, shipping, tax): strategy; repository per module |
| Advanced | Several providers per capability, switchable per tenant: adapter plus factory with config |

## Rules

### Minimum — always, never cut

- **Adapter: one per external provider, always.** Core code calls our own interface (`PaymentGateway.Charge`), never a provider SDK or its field names. The adapter converts amounts, statuses and errors both ways (`backend/data/money.md`).
- No interface for a thing with one implementation and no second one planned. A function type is enough.
- Provider webhook payloads are parsed in the adapter into our event shape; core never sees the raw payload.

### Standard — adds

- **Strategy: for rules that vary by named case and grow.** Pricing, discount, shipping and tax rules are a map from key to function (`Record<TRule, (Input) => Result>`), not a growing `switch`. Adding a case adds one entry and one test.
- **Repository: a module's data access layer** (`layering.md`), the place the tenant filter lives. Not a generic `Repository<T>` with `findAll/save` for every table; write named queries (`ListOpenByCustomer`).
- **Factory: only to choose an implementation from configuration** (provider per tenant, per environment). A factory that wraps `new X()` with no choice is ceremony.
- Each strategy is a pure function of its input (no database, no clock); the caller loads data and passes it in, so tests need no mocks.

### Advanced — adds

- Strategy keys come from data (a `PricingRule` row names the strategy and its parameters), validated by a Zod schema per strategy; unknown keys fail at save time, not at checkout.
- Adapters share a contract test suite run against each provider's sandbox and a fake.
- Provider failures map to a small set of our own errors (`Declined`, `Timeout`, `Unavailable`), so callers handle categories, not provider codes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Provider changes a field name or status code | Only the adapter changes; core and tests stay green |
| Second payment provider (Fawry beside a card gateway) | New adapter implementing the same interface; no change in the order flow |
| A discount rule is added mid-year | New strategy entry; old orders keep their stored discount, never recomputed (`backend/data/money.md`) |
| A tenant has a rule key that no longer exists | Save-time validation rejects removal while in use; at runtime an unknown key fails closed with a clear error, not a zero discount |
| Two strategies both apply to one cart | Order and combination are explicit in code and tested (stack, best-of, or first match), never by map iteration order |
| A "factory" that always returns the same class | Delete it; call the class |
| Data at 100×: strategy loads rules per line item | Rules are loaded once per request and passed in; the strategy stays pure and O(1) per line |
| Twice / parallel: the same charge sent twice through the adapter | The adapter passes our idempotency key to the provider (`backend/reliability/idempotency.md`), so the second call returns the first result |

## Example — Standard, Bun + Hono + Drizzle

```ts
export interface PaymentGateway {
  Charge(Input: { OrderId: string; AmountMinor: bigint; Currency: string; IdempotencyKey: string }): Promise<TChargeResult>
  Refund(Input: { PaymentRef: string; AmountMinor: bigint; IdempotencyKey: string }): Promise<TRefundResult>
}

export const PaymobAdapter: PaymentGateway = {
  async Charge(Input) {
    const Res = await PaymobClient.CreateIntention({
      amount: Number(Input.AmountMinor),
      currency: Input.Currency,
      merchant_order_id: Input.OrderId,
    }, Input.IdempotencyKey)
    return { Ref: Res.id, Status: MapPaymobStatus(Res.status) }
  },
  async Refund(Input) {
    const Res = await PaymobClient.Refund(Input.PaymentRef, Number(Input.AmountMinor), Input.IdempotencyKey)
    return { Ref: Res.id, Status: MapPaymobStatus(Res.status) }
  },
}

const Gateways = new Map<string, PaymentGateway>([["Paymob", PaymobAdapter], ["Fawry", FawryAdapter]])
export const GetGateway = (Name: string): PaymentGateway => {
  const Gateway = Gateways.get(Name)
  if (!Gateway) throw new AppError("GATEWAY_UNKNOWN", 500)
  return Gateway
}
```

```ts
const PercentSchema = z.object({ Bps: z.number().int().min(0).max(10_000) })
const FixedSchema = z.object({ AmountMinor: z.number().int().min(0) })

export const DiscountRules = new Map<string, (Subtotal: bigint, Params: unknown) => bigint>([
  ["PercentBps", (Subtotal, Params) => (Subtotal * BigInt(PercentSchema.parse(Params).Bps) + 5_000n) / 10_000n],
  ["FixedMinor", (_Subtotal, Params) => BigInt(FixedSchema.parse(Params).AmountMinor)],
])

export const ComputeDiscount = (Subtotal: bigint, Rule: string, Params: unknown) => {
  const Fn = DiscountRules.get(Rule)
  if (!Fn) throw new AppError("DISCOUNT_RULE_UNKNOWN", 500)
  const Raw = Fn(Subtotal, Params)
  return Raw < 0n ? 0n : Raw > Subtotal ? Subtotal : Raw
}
```

Rule params are validated per rule with Zod (integers only, so `BigInt` never sees a fraction), the result is clamped to `[0, Subtotal]`, and rules and gateways live in a `Map`, so a name like `constructor` is unknown instead of resolving through the prototype. `Number(Input.AmountMinor)` is safe only for a provider that takes a JSON number below 2^53; the adapter owns that conversion.

Other stacks: the same shape in C# (interface plus DI registration) or Laravel (contract plus service provider binding).

## Verify

- [ ] `[M]` `grep -rn "paymob\|fawry" src/` outside the adapter folder finds no provider names in core code.
- [ ] `[M]` Swapping the gateway for a fake in a test needs no change in the order service.
- [ ] `[S]` Adding a discount rule touches one map entry and one test file.
- [ ] `[S]` Unknown rule key fails with the named error, never as zero discount.
- [ ] `[A]` The same contract test passes for every adapter and the fake.

## Pitfalls

- **Interface per class "for testability"** → files doubling with no second implementation → mock the boundary only (provider, clock).
- **Generic `Repository<T>`** → leaks query shape to services, hides the tenant filter → named queries per module.
- **Strategy that reads the database** → hidden I/O, slow tests → load first, pass in.
- **Provider SDK types in core** → provider change ripples everywhere → adapter converts.

## Related

`architecture/layering.md` · `backend/data/money.md` · `backend/reliability/idempotency.md` · `backend/reliability/outbound-calls.md` · `domains/payments-egypt/gateway-checkout.md` · `quality/maintainability/solid-pragmatic.md`
