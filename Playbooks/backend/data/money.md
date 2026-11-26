# Money

- **Situation:** prices, carts, orders, invoices, discounts, taxes, refunds, balances, wallets, payouts, any currency. Display formatting only: `frontend/i18n-rtl.md`.
- **Skip when:** the app never stores an amount (it only links to a hosted checkout whose prices live in the provider, e.g. Stripe Price IDs). Then store the provider's ids and amounts as received.
- **Decision:** amounts are integers in the currency's minor unit (`bigint`) next to an ISO 4217 code; rounding happens once, at a named step, with a stated rule.

## Levels

| Level | Pick when |
|---|---|
| Minimum | One currency, fixed prices, no discounts or tax logic in our code |
| Standard | Orders with discounts, tax or a payment provider; refunds |
| Advanced | Stored balances, wallets, payouts, marketplaces, more than one currency |

A project at Minimum that takes real payments uses Standard here.

## Rules

### Minimum — always, never cut

- Column pair `AmountMinor bigint NOT NULL` + `Currency text NOT NULL`. Never `float`, `real`, `double`, or JS `number` arithmetic on decimal amounts.
- Parse user input from a decimal string to minor units once, at the edge. Inside the system only integers move.
- An order line stores its own unit price and quantity at purchase time. Never recompute a past order from today's prices.
- APIs send amounts as strings (`"15050"`), so no JSON client turns them into floats.

### Standard — adds

- Minor-unit exponent from a table, not an assumption: `EGP`/`USD`/`SAR` = 2, `JPY` = 0, `KWD`/`BHD`/`OMR` = 3.
- Percentages are basis points (`1500` = 15%). One rounding rule (half-up per line, then sum lines), named in the code.
- The order stores `SubtotalMinor`, `DiscountMinor`, `TaxMinor`, `TotalMinor`, with a `CHECK` that they add up.
- Splits (installments, partial refunds) allocate the remainder so parts sum exactly to the total.
- Before marking an order paid, compare the provider's amount and currency with the order total.

### Advanced — adds

- Balances are an append-only `LedgerEntries` table (signed amounts, `ReferenceType` + `ReferenceId`); a cached balance column changes only in the same transaction as its entry, by `SET "Balance" = "Balance" + $1`.
- Never add different currencies. Conversion stores the rate, its source and date; the converted row keeps the original amount.
- A daily reconciliation job compares ledger totals with the provider's settlement report and alerts on any difference.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Input `"1,000.50"`, `"١٥٠"` (Arabic-Indic digits), `" 150 "` | Normalised at the edge (digits mapped, separators per locale, trimmed); anything else is a 400 |
| More decimals than the currency allows (`"10.999"` EGP) | 400, never silently rounded |
| Discount larger than the subtotal | Discount is clamped to the subtotal; total never goes below zero |
| 100% coupon, total zero | Order is paid without calling the provider (most reject zero) |
| Tax-inclusive prices (VAT already in the shelf price) | `Tax = Total × Rate ÷ (1 + Rate)`, rounded once; subtotal = total − tax |
| Partial refund of a line bought with an order-level discount | Refund the line's share of the discount using the same allocation, not the list price |
| Provider uses major units (some gateways send `"150.50"`) | The provider adapter converts both ways; the core never sees a decimal |
| Cart in USD, user switches to EGP | The cart is repriced from the catalog in the new currency; amounts are never converted in place |
| Sum passes 2^53 minor units | `bigint` end to end; `Number()` on an amount is a bug |
| Negative amounts | Allowed only in ledger entries and refunds, with the sign convention documented on the table |

## Example — Standard, Bun + Hono + Drizzle

```ts
export const CURRENCY_EXPONENT: Record<string, number> = { EGP: 2, USD: 2, SAR: 2, AED: 2, EUR: 2, JPY: 0, KWD: 3, BHD: 3, OMR: 3 }

const ARABIC_DIGITS = /[٠-٩]/g

export function ToMinor(Input: string, Currency: string): bigint {
  const Exp = CURRENCY_EXPONENT[Currency]
  if (Exp === undefined) throw new AppError("MONEY_CURRENCY_UNSUPPORTED", 400)
  const Clean = Input.trim().replace(ARABIC_DIGITS, (D) => String(D.charCodeAt(0) - 0x0660)).replace(/,/g, "")
  const Match = /^(\d+)(?:\.(\d+))?$/.exec(Clean)
  if (!Match || (Match[2]?.length ?? 0) > Exp) throw new AppError("MONEY_INVALID_AMOUNT", 400)
  return BigInt(Match[1] + (Match[2] ?? "").padEnd(Exp, "0"))
}

export const ApplyBasisPoints = (Amount: bigint, Bps: bigint) => (Amount * Bps + 5_000n) / 10_000n

export function Allocate(Total: bigint, Parts: number): bigint[] {
  const Base = Total / BigInt(Parts)
  const Rest = Number(Total - Base * BigInt(Parts))
  return Array.from({ length: Parts }, (_, I) => Base + (I >= Parts - Rest ? 1n : 0n))
}

export const Orders = pgTable("Orders", {
  ...BaseColumns,
  Currency: text("Currency").notNull(),
  SubtotalMinor: bigint("SubtotalMinor", { mode: "bigint" }).notNull(),
  DiscountMinor: bigint("DiscountMinor", { mode: "bigint" }).notNull().default(0n),
  TaxMinor: bigint("TaxMinor", { mode: "bigint" }).notNull(),
  TotalMinor: bigint("TotalMinor", { mode: "bigint" }).notNull(),
}, (T) => [
  check("OrdersTotalCheck", sql`${T.TotalMinor} = ${T.SubtotalMinor} - ${T.DiscountMinor} + ${T.TaxMinor}`),
  check("OrdersNonNegative", sql`${T.TotalMinor} >= 0 AND ${T.DiscountMinor} <= ${T.SubtotalMinor}`),
])
```

The `,` removal assumes `.` as the decimal separator; a locale that writes `1.000,50` needs the separator from the user's locale, not a guess.

Other stacks: `numeric(19,4)` is acceptable where the codebase already uses it, with a decimal library (`decimal.js`, Python `Decimal`, C# `decimal`), never native floats. Stripe and Paymob take minor units: pass the stored integer as is.

## Verify

- [ ] `[M]` `grep -rnE "parseFloat|toFixed|Number\(.*(Price|Amount|Total)" src/` finds nothing on money paths.
- [ ] `[M]` No money column of type `real`, `double precision` or unscaled `numeric`.
- [ ] `[M]` Changing a product price leaves existing order totals unchanged.
- [ ] `[S]` 0.10 + 0.20 sums to exactly 30 minor units; 100.00 split in 3 is 33.33 + 33.33 + 33.34.
- [ ] `[S]` 15% on 9.99 is 1.50 under the stated rule; `"10.999"` EGP is rejected; `"١٥٠"` parses to 15000.
- [ ] `[S]` A webhook whose amount or currency differs from the order does not mark it paid.
- [ ] `[A]` Sum of `LedgerEntries` per account equals the cached balance after a concurrent test of 100 credits and debits.

## Pitfalls

- **`0.1 + 0.2` in JS** → `0.30000000000000004` → integers in minor units.
- **Rounding at different steps (line vs total)** → invoice off by one cent from the provider → one rule, one place.
- **Assuming two decimals** → KWD amounts off by a factor of ten → the exponent table.
- **Balance overwritten from app code** → lost updates under concurrency → ledger or atomic increment.

## Related

`reliability/idempotency.md` · `data/concurrency.md` · `Stacks/Database.md` §2 §5
