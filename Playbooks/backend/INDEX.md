# Backend playbooks

Pick 1–3 files whose situation matches the task. File paths in this table are relative to this folder; paths inside playbooks are relative to `Playbooks/`. `planned` = not written yet: work without it and say so.

Read first for any schema or query work: `Stacks/Database.md`. Default stack conventions: `Stacks/Bun-Hono.md`.

## API

| Situation | File | Status |
|---|---|---|
| New endpoint, URL and status-code choices | `api/rest-design.md` | ✅ |
| List endpoint, "load more", infinite scroll | `api/pagination.md` | ✅ |
| Error shape, validation errors, error codes | `api/error-format.md` | ✅ |
| Breaking change to a public or mobile API | `api/versioning.md` | ✅ |

## Auth

| Situation | File | Status |
|---|---|---|
| Sign-in, sign-out, sessions, refresh tokens | `auth/sessions.md` | ✅ |
| Forgot password, reset link, magic link, email verification token | `auth/password-reset.md` | ✅ |
| Roles, permissions, "only the owner can edit" | `auth/rbac.md` | ✅ |
| Sign in with Google / Apple | `auth/oauth.md` | ✅ |
| API keys for customers or integrations | `auth/api-keys.md` | ✅ |
| OTP by SMS or email, 2FA | `auth/otp.md` | ✅ |

## Data

| Situation | File | Status |
|---|---|---|
| Prices, balances, invoices, discounts, currency | `data/money.md` | ✅ |
| Schema change on a live database | `data/migrations.md` | ✅ |
| Delete, archive, restore, "trash" | `data/soft-delete.md` | ✅ |
| Reports per day are off, "today" is wrong, dates shift, storing and comparing times and zones | `data/time-zones.md` | ✅ |
| Several companies or stores in one app (SaaS) | `data/multi-tenancy.md` | ✅ |
| Stock, seats, coupons, anything two users can grab at once | `data/concurrency.md` | ✅ |
| Who changed what, history, audit log | `data/audit-log.md` | ✅ |
| One request changes many rows: order or invoice lines, stocktake, bulk edits | `data/batch-edits.md` | ✅ |

## Reliability

| Situation | File | Status |
|---|---|---|
| Payments, webhooks, any write the client or a provider may retry | `reliability/idempotency.md` | ✅ |
| Emails, reports, imports, anything slow or scheduled | `reliability/background-jobs.md` | ✅ |
| Calling a third-party API | `reliability/outbound-calls.md` | ✅ |
| Abuse limits, brute force, quotas | `reliability/rate-limit.md` | ✅ |
| Caching reads, Redis, invalidation | `reliability/caching.md` | ✅ |

## Files

| Situation | File | Status |
|---|---|---|
| User uploads: images, documents, avatars | `files/uploads.md` | ✅ |
| CSV / Excel import and export | `files/import-export.md` | ✅ |
