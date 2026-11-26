# Money

- **Situation:** prices, carts, orders, invoices, balances, wallets, discounts, taxes, refunds, payouts, any currency. Not for display formatting only on the frontend (`frontend/i18n-rtl.md`).
- **Decision:** store and compute money as integers in the currency's minor unit (`bigint`) with an ISO 4217 currency code next to it; round once, at a named step, with a stated rule.

## Rules

- Column pair: `AmountMinor bigint NOT NULL` + `Currency text NOT NULL CHECK (char_length("Currency") = 3)`. Never `float`, `real`, `double` or JS `number` arithmetic on decimal amounts.
- Minor-unit exponent comes from a table, not an assumption: `EGP`/`USD`/`SAR` = 2, `JPY` = 0, `KWD`/`BHD`/`OMR` = 3.
- Parse user input from a decimal string to minor units once, at the edge. Inside the system only integers move.
- In TypeScript, use `bigint` when sums can pass 2^53 (≈ 90 trillion minor units); `number` is acceptable only for single item prices validated with `Number.isSafeInteger`.
- Percentages (tax, discount, commission) are basis points (`1500` = 15%) as integers. Rounding: half-up per line, then sum the lines; write the rule in the code's name (`RoundHalfUp`).
- Splitting an amount (installments, refunds across items): allocate the remainder to the last parts so the parts sum exactly to the total.
- An order stores its own computed `SubtotalMinor`, `DiscountMinor`, `TaxMinor`, `TotalMinor` and the price snapshot of each line. Never recompute a past order from today's prices.
- Never add amounts of different currencies. Conversion uses a stored rate with its date, and the converted row keeps the original amount.
- Balances: an append-only `LedgerEntries` table (signed amounts); the balance is the sum, or a cached column updated in the same transaction. Never `UPDATE Balance = $new` computed in app code.
- The payment provider's amount is compared with the order total, in minor units and the same currency, before marking paid.

## Example — Bun + Hono + Drizzle

```ts
export const CURRENCY_EXPONENT: Record<string, number> = { EGP: 2, USD: 2, SAR: 2, AED: 2, EUR: 2, JPY: 0, KWD: 3, BHD: 3, OMR: 3 }

export function ToMinor(Decimal: string, Currency: string): bigint {
  const Exp = CURRENCY_EXPONENT[Currency]
  if (Exp === undefined) throw new AppError("MONEY_CURRENCY_UNSUPPORTED", 400)
  const Match = /^(\d+)(?:\.(\d+))?$/.exec(Decimal.trim())
  if (!Match || (Match[2]?.length ?? 0) > Exp) throw new AppError("MONEY_INVALID_AMOUNT", 400)
  return BigInt(Match[1] + (Match[2] ?? "").padEnd(Exp, "0"))
}

export const ApplyBasisPoints = (Amount: bigint, Bps: bigint) => (Amount * Bps + 5_000n) / 10_000n

export function Allocate(Total: bigint, Parts: number): bigint[] {
  const Base = Total / BigInt(Parts)
  const Rest = Total - Base * BigInt(Parts)
  return Array.from({ length: Parts }, (_, I) => Base + (BigInt(I) >= BigInt(Parts) - Rest ? 1n : 0n))
}

export const Orders = pgTable("Orders", {
  ...BaseColumns,
  Currency: text("Currency").notNull(),
  SubtotalMinor: bigint("SubtotalMinor", { mode: "bigint" }).notNull(),
  DiscountMinor: bigint("DiscountMinor", { mode: "bigint" }).notNull().default(0n),
  TaxMinor: bigint("TaxMinor", { mode: "bigint" }).notNull(),
  TotalMinor: bigint("TotalMinor", { mode: "bigint" }).notNull(),
}, (T) => [check("OrdersTotalCheck", sql`${T.TotalMinor} = ${T.SubtotalMinor} - ${T.DiscountMinor} + ${T.TaxMinor}`)])
```

API responses send `{ AmountMinor: "15050", Currency: "EGP" }` with the amount as a string, so JSON clients never parse it as a float; the frontend formats with `Intl.NumberFormat`.

Other stacks: Postgres `numeric(19,4)` is acceptable when the codebase already uses it, with a decimal library (`decimal.js`, Python `Decimal`, C# `decimal`), never native floats. Stripe and Paymob already take minor units: pass the stored integer as is.

## Verify

- [ ] `grep -rn "parseFloat\|toFixed\|Number(.*[Pp]rice" src/` finds nothing on money paths.
- [ ] No money column of type `real`, `double precision` or `numeric` without scale.
- [ ] Test: three items at 0.10 + 0.20 sum to exactly 0.30 in minor units.
- [ ] Test: 100.00 split in 3 gives 33.33 + 33.33 + 33.34.
- [ ] Test: 15% tax on 9.99 rounds per the stated rule (1.50).
- [ ] Changing a product price leaves existing order totals unchanged.
- [ ] A webhook with a different amount or currency than the order does not mark it paid.

## Pitfalls

- **`0.1 + 0.2` in JS** → 0.30000000000000004 → integers in minor units.
- **Rounding each step differently (line vs total)** → invoice totals disagree by one cent with the provider → one rounding rule, one place.
- **Assuming two decimals** → KWD amounts off by a factor of ten → the exponent table.
- **Balance overwritten from app code** → lost updates under concurrency → ledger entries or an atomic `SET "Balance" = "Balance" + $1`.
- **Amount as JSON number above 2^53** → silent precision loss in clients → string in the API.

## Related

`reliability/idempotency.md` · `data/concurrency.md` · `Stacks/Database.md` §2 §5
