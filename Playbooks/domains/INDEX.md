# Business-domain playbooks

Pick 1–3 files whose situation matches the task. Paths in this table are relative to this folder; paths inside playbooks are relative to `Playbooks/`. These build on `backend/` (money, concurrency, multi-tenancy, idempotency) and link to it instead of repeating it.

## Billing

| Situation | File |
|---|---|
| Plans, monthly or yearly renewals, cancel at period end, a billing job that must never bill a period twice | `billing/subscriptions.md` |
| Customer upgrades or downgrades mid-period and we must charge or credit the difference | `billing/proration.md` |
| Discount or promo codes with limits, per-tenant codes, one code per invoice | `billing/coupons.md` |
| Split one invoice into parts or installments and void the original | `billing/invoice-splits.md` |
| Full, partial or parallel refunds that must never exceed what was paid | `billing/refunds.md` |
| A renewal payment failed: retries, grace period, suspend, reactivate | `billing/dunning.md` |
| Adding 14% VAT, inclusive prices, issued invoices that need correcting, Egyptian e-invoice | `billing/vat-egypt.md` |

## Inventory

| Situation | File |
|---|---|
| Quantity per branch, stock going negative, overselling, "الكمية مش مظبوطة" | `inventory/stock-ledger.md` |
| Moving stock between branches, goods on the road, partial receive, cancel a transfer | `inventory/transfers.md` |
| Holding stock for a cart or pending payment, hold expiry, last unit sold twice | `inventory/reservations.md` |
| Physical count (جرد), variance report, counting while selling | `inventory/stock-counts.md` |
| Lots, expiry dates, FEFO, expired goods, recall | `inventory/batches-expiry.md` |

## Booking

| Situation | File |
|---|---|
| Show free times, working hours, breaks, holidays, staff or room schedules | `booking/availability.md` |
| Two people booked the same slot, overbooking, hold the slot while paying | `booking/double-booking.md` |
| Customer cancels, moves, no-shows, or has a deposit and refund | `booking/cancellations.md` |
| Weekly or repeating appointments or classes, edit one vs all following | `booking/recurring.md` |

## Commerce

| Situation | File |
|---|---|
| Cart, add to cart, checkout, "price changed since I added it", "double click made two orders" | `commerce/cart-checkout.md` |
| Order statuses, cancel/ship transitions, "order stuck in a wrong status", status from webhook or admin | `commerce/order-state-machine.md` |
| Shipping fees per governorate, courier integration and status webhooks, COD collection | `commerce/shipping.md` |
| Customer returns, partial return, restock or damaged, refund amount, return window | `commerce/returns.md` |
| Loyalty points earn/redeem, expiry, reversal on refund, "points went negative" | `commerce/loyalty-points.md` |

## Payments (Egypt)

| Situation | File |
|---|---|
| Card payment through Paymob/Kashier/Geidea/Stripe: create the order, verify the callback, "paid but order still pending", missing callbacks | `payments-egypt/gateway-checkout.md` |
| Fawry-style pay-at-outlet code: expiry, customer paid after the code expired, partial or duplicate notification | `payments-egypt/fawry-reference-pay.md` |
| Vodafone Cash wallet, InstaPay or bank transfer with a receipt screenshot, staff confirming manually, duplicate receipts | `payments-egypt/wallets-instapay.md` |
| Refund or void through the payment gateway, partial refund, refund failed or timed out, refund callback | `payments-egypt/gateway-refunds-voids.md` |

## Fintech

| Situation | File |
|---|---|
| Wallet balance, top-up, spend, transfer between wallets, holds, statement, "الرصيد مش مظبوط" | `fintech/wallets.md` |
| Split a purchase into monthly installments, late fees, early payoff, partial payments, rescheduling | `fintech/installments.md` |
| Paying merchants or drivers: batches, minimum, holding period, failed payout, bank details change | `fintech/payouts.md` |
| Matching our payments with the gateway settlement report, mismatches, fees | `fintech/reconciliation.md` |

## Messaging

| Situation | File |
|---|---|
| One event must reach the user in-app, push, email and SMS; preferences, quiet hours, unread badge, "الاشعار وصل مرتين" | `messaging/notifications.md` |
| Transactional email, Arabic RTL templates, bounces and spam complaints, "الايميل راح سبام" | `messaging/email.md` |
| SMS to Egyptian numbers, E.164, cost and segments, sender name, rate limits | `messaging/sms.md` |
| WhatsApp Business API, approved templates, 24-hour window, inbound webhook and media | `messaging/whatsapp.md` |
| Mobile push (FCM/APNs), device tokens, invalid-token cleanup, deep links, silent push | `messaging/push.md` |
