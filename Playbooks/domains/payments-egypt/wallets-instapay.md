# Wallets and InstaPay Transfers

- **Situation:** Vodafone Cash / Orange / Etisalat wallets through a gateway, InstaPay or bank transfer with a receipt screenshot, "العميل بعت صورة التحويل", "اكد الدفع يدوي", "تحويل انستاباي".
- **Skip when:** only card checkout (`gateway-checkout.md`) or only cash on delivery. Gateway-hosted wallet payments are mostly `gateway-checkout.md`; this file covers their differences plus the manual path.
- **Decision:** a gateway wallet payment is confirmed by the verified callback, like cards. A manual transfer is confirmed only by an authorised staff member who checks the real bank or wallet statement; the customer's upload is evidence, never proof. Every confirmation records who, when and against which amount. Provider names, fields and flows must be verified against current docs. Conventions are defaults when the project has none; the owner's rules and existing code win; the safety invariants stay absolute.

## Levels

| Level | Pick when |
|---|---|
| Minimum | A few manual transfers a day, one reviewer |
| Standard | Regular volume, several staff, audit needed |
| Advanced | Bank statement import or provider API to match transfers automatically |

## Rules

### Minimum — always, never cut

- A customer upload creates `PaymentClaims(Status = 'Submitted')` only. It never changes the order status, never releases goods.
- Confirmation is a staff action behind a permission (`backend/auth/rbac.md`), ideally not the person who handles fulfilment of the same order. It stores `ConfirmedBy`, `ConfirmedAt`, `ConfirmedAmountMinor`, `BankReference` (the statement's transaction reference).
- Confirmation is one conditional update from `Submitted`; two staff pressing confirm cannot both succeed.
- Receipt files: validate type and size at the edge (JPEG, PNG, PDF; 5 MB), store outside the web root with a random name, serve through a signed URL, never trust the filename or content type sent.
- Confirmed amount and currency must equal the order total; any difference sends the claim to `NeedsReview`, not to paid.

### Standard — adds

- Duplicate detection: unique index on `(TenantId, BankReference)` when staff enter it; a SHA-256 of the file stored and warned on reuse across orders; same amount, same sender, same minute window flagged.
- Reject, request-new-receipt and confirm are all audited events with actor, time and reason (`backend/data/audit-log.md`); history is append-only.
- A claim expires: no confirmation within the agreed window (default 48 h) moves the order to `Cancelled` through the state machine, and the customer is told; a later confirmation reopens only by an explicit staff action.
- Customer sees the claim state (`Submitted`, `NeedsReview`, `Rejected`, `Confirmed`) without seeing other claims.
- Gateway wallet payments: wallet number and the prompt on the customer's phone are the gateway's job; we never store the PIN or OTP. The result arrives as a callback and is applied by the same transition code as cards (`gateway-checkout.md`).
- Amount mismatch outcomes are explicit: underpaid keeps the order `PendingPayment` with a visible remainder; overpaid confirms the order and records `ExcessMinor` for refund (`gateway-refunds-voids.md`).

### Advanced — adds

- Statement CSV or API import matches claims by reference, amount and date; a match proposes confirmation, staff approve.
- Daily report of claims older than 24 h still `Submitted`.
- Four-eyes approval above a configured amount.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The same screenshot uploaded for two orders | File hash match: second claim goes `NeedsReview` with a link to the first |
| Edited or fake receipt image | Never accepted on sight; staff verify against the real statement, and the reference is entered by staff |
| Customer pays the wrong amount (EGP 995 for 1,000) | `NeedsReview`; staff choose: ask for the rest, or reject and refund |
| Customer sends two transfers for one order, each partial | Claims are summed per order only by staff; the order is paid when confirmed amounts total the order amount |
| Transfer made, no receipt sent | Staff may create the claim on the customer's behalf from the statement, recorded with their name |
| Staff confirms, then finds the transfer reversed | Confirmation is revoked by a new audited event; order moves back through allowed transitions or to refund-needed; the old event stays |
| Two staff confirm at once | Conditional update lets one succeed; the other sees "already confirmed by X at Y" |
| Receipt in a 12 MB photo or a disguised file | Rejected at the edge by size and magic bytes, not by extension |
| Customer in another tenant guesses a claim id | Tenant filter returns 404 (`backend/data/multi-tenancy.md`) |
| Wallet prompt expired on the customer's phone | Gateway sends a failed callback; attempt `Failed`; the customer can try again; no order change |
| 100×: Thousands of claims | Review queue paged by `(Status, CreatedAt)`; file hash lookup is indexed |
| Twice / parallel: Customer uploads the same receipt twice | Same hash on the same order: the second is rejected as duplicate, not stacked |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ConfirmClaim(ClaimId: string, Staff: AuthUser, Input: ConfirmInput) {
  return db.transaction(async (Tx) => {
    const [Claim] = await Tx.select().from(PaymentClaims)
      .where(and(eq(PaymentClaims.Id, ClaimId), eq(PaymentClaims.TenantId, Staff.TenantId)))
      .for("update")
    if (!Claim) throw new AppError("CLAIM_NOT_FOUND", 404)
    if (Claim.Status !== "Submitted" && Claim.Status !== "NeedsReview") {
      throw new AppError("CLAIM_ALREADY_RESOLVED", 409)
    }
    const [Order] = await Tx.select().from(Orders)
      .where(and(eq(Orders.Id, Claim.OrderId), eq(Orders.TenantId, Staff.TenantId)))
      .for("update")
    if (Input.AmountMinor !== Order.TotalMinor) {
      await Tx.update(PaymentClaims).set({ Status: "NeedsReview", ConfirmedAmountMinor: Input.AmountMinor }).where(eq(PaymentClaims.Id, Claim.Id))
      return "NeedsReview"
    }
    await Tx.update(PaymentClaims)
      .set({ Status: "Confirmed", ConfirmedBy: Staff.Id, ConfirmedAt: new Date(), ConfirmedAmountMinor: Input.AmountMinor, BankReference: Input.BankReference })
      .where(eq(PaymentClaims.Id, Claim.Id))
    await Tx.update(Orders).set({ Status: "Paid", PaidAt: new Date() }).where(and(eq(Orders.Id, Order.Id), eq(Orders.Status, "PendingPayment")))
    await Tx.insert(AuditLog).values({ TenantId: Staff.TenantId, ActorId: Staff.Id, Action: "PaymentClaimConfirmed", EntityId: Claim.Id })
    return "Confirmed"
  })
}
```

A duplicate `BankReference` raises the unique violation inside the transaction; map it to `409 DUPLICATE_BANK_REFERENCE`.

## Verify

- [ ] `[M]` Uploading a receipt leaves the order `PendingPayment`.
- [ ] `[M]` A user without the confirm permission gets `403`; with it, `ConfirmedBy` and `ConfirmedAt` are stored.
- [ ] `[M]` Confirming with an amount that differs from the order does not mark it paid.
- [ ] `[S]` The same file on another order is flagged; the same `BankReference` twice is `409`.
- [ ] `[S]` Two parallel confirms: one succeeds, one returns `409`.
- [ ] `[S]` Every confirm, reject and revoke appears in the audit log with the actor.
- [ ] `[A]` An imported statement line proposes a match and changes nothing until staff approve.

## Pitfalls

- **Marking paid when the receipt is uploaded** → fake screenshots ship goods → claim state only.
- **Letting the same person order, confirm and fulfil** → no control → separate permission, audited.
- **Serving receipts from a public folder with guessable names** → customers' bank data leaks → signed URLs, random names.
- **Deduplicating only by filename** → the same image renamed passes → content hash.
- **Overwriting the confirmation on revoke** → audit trail lost → append a new event.

## Related

`domains/payments-egypt/gateway-checkout.md` · `domains/payments-egypt/gateway-refunds-voids.md` · `backend/auth/rbac.md` · `backend/data/audit-log.md` · `backend/data/money.md` · `backend/reliability/idempotency.md`
