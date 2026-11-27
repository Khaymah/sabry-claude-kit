# Cart and checkout

- **Situation:** cart, add to cart, checkout, place order, "price changed since I added it", "double click created two orders", totals on the order.
- **Skip when:** the checkout is a hosted page of a provider that owns cart and prices (payment link, Shopify).
- **Decision:** the cart stores intent (product, quantity) only; checkout reprices everything from the catalog inside one transaction, writes a totals snapshot on the order, and is idempotent per attempt. Money rules: `backend/data/money.md`.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Small shop, few products, no stock limits or coupons |
| Standard | Real orders with stock, coupons or VAT |
| Advanced | Flash sales, reservations, multi-warehouse, carts shared across devices |

## Rules

### Minimum — always, never cut

- The cart never stores a price the checkout trusts. Client-sent prices, totals and discounts are ignored; checkout reads prices from the catalog, tenant-filtered.
- Checkout recomputes every line in one transaction and writes `Orders` and `OrderLines` there. Each line stores `UnitPriceMinor`, `Quantity`, `DiscountMinor`, `TaxMinor`, `Name` snapshot.
- Stock is decremented by an atomic conditional `UPDATE` in that transaction (`backend/data/concurrency.md`).
- Place-order takes an `Idempotency-Key`; the same key returns the first order, never a second one (`backend/reliability/idempotency.md`).
- Quantity is validated at the edge: integer, 1 to a per-line cap, never negative or fractional.

### Standard — adds

- Checkout returns the repriced total; if it differs from the total the client showed (`ExpectedTotalMinor`), respond `409 PRICE_CHANGED` (defaults; keep the project's codes) with the new lines and create nothing. The client confirms and resubmits.
- Unavailable lines (deleted, inactive, out of stock) are reported per line in one `409 CART_INVALID`; the checkout compares every cart line with its joined product (left join, never an inner join that drops rows silently); the order is never half-created.
- Order stores `SubtotalMinor`, `DiscountMinor`, `ShippingMinor`, `TaxMinor`, `TotalMinor` with the sum `CHECK`, plus the coupon code and rule snapshot that applied.
- A guest cart merges into the user's cart on login by summing quantities per product, capped, then the guest cart is deleted.
- Carts expire (default 30 days of inactivity); an expired cart read returns empty, not an error.

### Advanced — adds

- Checkout creates a `Reservations` row with `ExpiresAt` (default 15 min) instead of decrementing stock; payment success converts it, a job releases expired ones.
- Cart lines carry a `Version`; two devices editing the same cart get `409 EDIT_CONFLICT`.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Price dropped or rose since add-to-cart | Checkout uses the current price; if the total differs from `ExpectedTotalMinor` → `409 PRICE_CHANGED`, nothing created |
| Product deleted or hidden while in a cart | Cart read marks the line `Unavailable`; checkout rejects with the line id |
| Stock fell below the cart quantity | Per-line `OUT_OF_STOCK` with `Available`; the client may reduce the quantity and retry |
| Coupon expired or limit reached between cart and checkout | Checkout recomputes without it and returns `409 PRICE_CHANGED` with the reason |
| Same product added twice (two rows or two tabs) | One row per product (unique `(CartId, ProductId)`); add is `INSERT … ON CONFLICT DO UPDATE SET Quantity = Quantity + $n` |
| Variant or size removed after add | Line is `Unavailable`; never silently swapped for another variant |
| Checkout on a past order's cart id | Cart is closed (`Status = 'CheckedOut'`) in the same transaction; reuse → `409 CART_CLOSED` |
| Cart total after VAT/shipping rounds differently than the line sum | Round per line, sum lines; the snapshot is the truth, never recomputed later |
| Data at 100×: users with 5,000 abandoned carts | Cart read is by `UserId` index, lines capped (default 100 per cart); abandoned carts purged by a job in batches |
| Twice / parallel: double click or two tabs on "Place order" | Same key: the second waits or returns the first order. Different keys on one cart: the first closes the cart with `UPDATE … WHERE Status = 'Open'`; the second matches no row → `409 CART_CLOSED` |
| Old orders created before totals were snapshotted | Never recompute them from current prices; backfill from stored lines or mark `TotalsEstimated` |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function PlaceOrder(TenantId: string, UserId: string, CartId: string, ExpectedTotalMinor: bigint) {
  return db.transaction(async (Tx) => {
    const [Cart] = await Tx.update(Carts).set({ Status: "CheckedOut" })
      .where(and(eq(Carts.Id, CartId), eq(Carts.TenantId, TenantId), eq(Carts.UserId, UserId), eq(Carts.Status, "Open")))
      .returning()
    if (!Cart) throw new AppError("CART_CLOSED", 409)
    const Rows = await Tx.select({ ProductId: CartLines.ProductId, Quantity: CartLines.Quantity, Price: Products.PriceMinor, Name: Products.Name, IsActive: Products.IsActive })
      .from(CartLines)
      .leftJoin(Products, and(eq(Products.Id, CartLines.ProductId), eq(Products.TenantId, TenantId)))
      .where(eq(CartLines.CartId, CartId))
      .orderBy(CartLines.ProductId)
    if (Rows.length === 0) throw new AppError("CART_INVALID", 409)
    const Invalid = Rows.filter((R) => R.Price === null || !R.IsActive).map((R) => ({ ProductId: R.ProductId, Reason: "UNAVAILABLE" }))
    if (Invalid.length > 0) throw new AppError("CART_INVALID", 409, { Lines: Invalid })
    const Lines = Rows.map((R) => ({ ProductId: R.ProductId, Quantity: R.Quantity, Price: R.Price!, Name: R.Name! }))
    await ReserveStock(Tx, Lines.map((L) => ({ ProductId: L.ProductId, Quantity: L.Quantity })))
    const Subtotal = Lines.reduce((S, L) => S + L.Price * BigInt(L.Quantity), 0n)
    const Totals = ComputeTotals(Subtotal, Cart.CouponCode)
    if (Totals.TotalMinor !== ExpectedTotalMinor) throw new AppError("PRICE_CHANGED", 409, { Totals })
    const [Order] = await Tx.insert(Orders).values({ TenantId, UserId, Status: "Pending", ...Totals }).returning()
    await Tx.insert(OrderLines).values(Lines.map((L) => ({ OrderId: Order.Id, ProductId: L.ProductId, Name: L.Name, UnitPriceMinor: L.Price, Quantity: L.Quantity })))
    return Order
  })
}
```

The throw rolls back the whole transaction, including the cart close and the stock decrement. Wrap with the idempotency middleware at the route.

Other stacks: any ORM works if stock decrement and cart close are conditional single statements inside one transaction.

## Verify

- [ ] `[M]` Posting a forged `Price` or `Total` in the body changes nothing on the order.
- [ ] `[M]` Two parallel place-order calls with the same key create one order and one stock decrement.
- [ ] `[M]` Changing a product price afterwards leaves existing order lines unchanged.
- [ ] `[S]` Price change between cart and checkout returns `409 PRICE_CHANGED` and no order or stock change.
- [ ] `[S]` Two parallel place-orders with different keys on one cart: exactly one succeeds.
- [ ] `[A]` Expired reservations return stock; paying after expiry re-checks stock instead of overselling.

## Pitfalls

- **Total computed in the browser and trusted** → price tampering → server recomputes always.
- **Stock checked in one query, decremented in another** → oversell → one conditional `UPDATE`.
- **Network call (payment, shipping rate) inside the transaction** → locks held for seconds → do it before or after.
- **Order lines joined to live product price on read** → history changes with the catalog → read the snapshot columns.

## Related

`backend/data/money.md` · `backend/data/concurrency.md` · `backend/reliability/idempotency.md` · `domains/commerce/order-state-machine.md`
