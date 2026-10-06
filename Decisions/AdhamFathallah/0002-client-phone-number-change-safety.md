# ADR 0002 — Safely allowing ClientPhoneNumber edits from the admin dashboard

- **Project:** AdhamFathallah (real-estate backend, Node + forked Sequelize + MariaDB) + adham-dashbord
- **Status:** Accepted & implemented (2026-09-22). Browser E2E of the submit/confirm path is still pending consent. See "حالة التنفيذ" at the end.
- **Date:** 2026-09-22
- **Deciders:** Sabry

## Context

Sabry asked to "add the ability to change a Client's phone number," while flagging himself that phone
number is the de-facto Primary identity method and is linked in many places (Blacklist, Contact
Tracker, etc.).

Investigation found this is **not a net-new feature** — `EditClientModal.tsx` already renders
`ClientPhoneNumber`/`ClientPhoneNumber2` as live-editable `PhoneNumberField` inputs, submitted on
every save via `PUT /admin/clients` → `ClientRepository.Update`. The capability exists in
production today, completely unguarded, and sits on top of a real bug:

- `_Server/Repository/Client.js:191` — the duplicate-phone check on Update tests `.length` on the
  result of a `findOne()` (a single model instance, not an array) — always falsy. **The check is
  dead code.** `Create`'s equivalent check (`:126-133`, `if (FindResult)`) is correct.
- `_Server/Database/Models/Client.js:19-20` — no `unique: true` on `ClientPhoneNumber`, and no
  migration adds a DB-level unique index. Nothing stops two Clients from ending up with the same
  phone number via Update today.
- `Auth.js:112-119` — login resolves the account by `ClientPhoneNumber OR ClientPhoneNumber2`, and
  forgot/reset/resend-OTP flows (`Auth.js:182,255,306-311,367,439`) find-by-phone and deliver the
  OTP to that number. **Combined with the two bugs above, an admin can today set a client's phone
  to a number they control, then use "forgot password" to take over that client's account** — no
  malicious intent required, a support-desk typo has the same effect.

Broader blast radius found by a full-repo scan (see `docs/JobApplications-Actions-Plan.md` sibling
research isn't relevant here — see the phone-number research instead, summarized below):

- **Frozen snapshots that silently break on edit:** `KeyAccount.js:29` matches a client's historical
  lead inbox against a snapshot string frozen at `_RepoHelpers.js:514` — editing a key account's
  phone permanently orphans their lead history; old rows never re-match.
- **Live-derived status that silently flips:** `Client.js:105-108,151-154` — `IsTeam`/`IsKeyAccount`
  are computed live from `Contacts.ContactNumber = ClientPhoneNumber`. An edit can silently strip
  key-account status (and whatever it gates — discount approval authority, notification targeting).
- **Blacklist matching uses three incompatible phone normalizations** across the codebase (`+`-
  prefixed, digits-only, and a third SQL-level form) — rows created without a `BlacklistUserId` link
  orphan on any phone edit.
- **External/CRM desync:** `Est8CoreClient.js`/`Est8CoreLeadSync.js` snapshot the phone at lead
  registration; edits never propagate to the CRM, which dedupes by phone.
- **Minor, edge-case only:** `EnsureAdmin.js` only promotes-by-phone when the system has **zero**
  Administrators at boot (`:28` early-returns otherwise) — reassigning a phone to the bootstrap
  `ADMIN_KEY` value is not a practical escalation path in normal operation (an Administrator already
  exists). Noted for completeness, not a primary driver of this decision.
- **Checked and NOT a concern:** JWT claims carry the phone but every request re-resolves `req.Client`
  live via `findByPk` — stale claims are cosmetic only. Contact Tracker / Client History / Discount
  Requests / Consultations all join **live on `ClientId`**, so past records correctly show the
  client's current number (no historical-record corruption there — the opposite risk applies: an
  export of "what number were they contacted on" retroactively shows the new number, not the one
  actually in effect).

## Decision

**Baseline fixes — ship regardless of which option below is chosen, independent bug fixes:**

1. ✅ **Done** (commit `883d8ea`, 2026-09-22, shipped alongside the Profile page work). Fixed the
   dead duplicate-check in `ClientRepository.Update` (mirrors `Create`'s `if (FindResult)` pattern,
   scoped to exclude the client's own row via `ClientId: { [Op.ne]: ... }`).
2. ✅ **Done** (same commit, migration `031_unique_client_phone_number.migration.js`). Adds a
   DB-level unique index on `ClientPhoneNumber` only — the migration's own comment already states
   why it can't also cover `ClientPhoneNumber2` (a single `UNIQUE INDEX` can't express cross-column
   uniqueness), leaving that case as an application-level responsibility. **Re-checked 2026-09-22
   during the OTP-flow design pass, and that application-level coverage does not actually exist
   yet — see the new finding right below.** Idempotent/duplicate-safe design already in place
   (skips with a loud warning instead of crashing `AUTO_MIGRATE=true` if dirty data exists).
   - ✅ **Found and fixed same-day (2026-09-22), during this design pass.** Both `Register`
     (`Auth.js:35-48`) and `Update`'s fixed check (`Client.js:188-203`) built
     `Op.or: [{ClientPhoneNumber}, {ClientPhoneNumber2}]` — same-column matching only. Neither
     checked the submitted `ClientPhoneNumber` against another client's existing
     `ClientPhoneNumber2`, or vice versa. Since `Auth.js:112-119` (login) and the forgot-password
     lookup both resolve accounts via `Op.or` across *both* columns, two different clients could
     end up "sharing" a number (one's `ClientPhoneNumber`, the other's `ClientPhoneNumber2`) with
     no error at write time, and a login/OTP-recovery attempt with that number would then resolve
     to whichever row `findOne` happened to return first — a live account-confusion bug, independent
     of this ADR's new endpoints. **Fixed:** both call sites now build the `Op.or` across all four
     column combinations (`NumbersToCheck.flatMap((n) => [{ClientPhoneNumber: n},
     {ClientPhoneNumber2: n}])`), excluding self on Update. Verified: syntax-checked, server
     restarted cleanly (migrations unchanged, nothing new to apply), and the exact bug scenario
     was simulated in isolation (existing client with `ClientPhoneNumber2` = X, new submission
     with `ClientPhoneNumber` = X) — confirmed the old same-column logic would have missed it and
     the new cross-column logic catches it. Not reproduced against live data: no client in the
     current dataset has `ClientPhoneNumber2` genuinely different from its own `ClientPhoneNumber`
     (checked), so there was no real asymmetric pair to test end-to-end without writing synthetic
     collision data into the shared DB, which was deliberately avoided.
3. Give phone-number changes their own permission key, `clients.changePhoneNumber`, separate from
   general `clients.update` — same precedent as `clients.whitelist` (comment at
   `Client.js:79-80`: *"this key bypasses a security control, so it deserves its own gate"*). Phone
   number is exactly that kind of key.
4. Audit-log every phone number change (`Logger.Warn("ClientPhoneNumberChanged", {actor, actorIp,
   clientId, oldNumber, newNumber})`) — same pattern already used for Whitelist
   (`Client.js:306-312`).
5. Before committing a change, if the client `IsKeyAccount`, show the admin an explicit warning that
   their historical lead inbox (frozen `ContactTracker` snapshot) will stop matching — this is a
   known, accepted, *not automatically fixed* trade-off (see Consequences).

**Choose ONE for the change flow itself:**

- **Option A — OTP-reverify the new number before committing.** Admin submits the new number →
  backend sends an OTP to *that* number (reusing existing OTP infra) → admin (typically on a call
  with the client) reads back the code → only then does the write happen. Closes the account-
  takeover vector completely, since nobody can redirect a client's login without proving control of
  the destination number. Matches the realistic support scenario ("client lost their old number,
  wants it updated") almost exactly — the client reads the OTP over the phone during the call.
- **Option B — Baseline fixes only, no re-verification.** Faster to ship. Meaningfully safer than
  today (duplicate/unique bugs fixed, audit trail exists, dedicated permission limits who can do it
  at all). Leaves open: an admin *with* `clients.changePhoneNumber` can still redirect a client's
  OTP-based account recovery to a number they control, with only an audit-log trail after the fact
  (detective, not preventive control).

Sabry to pick A or B — not decided by this ADR.

**Resolved 2026-09-22 — Option A confirmed, plus two follow-up scope questions Sabry raised while
reviewing the finished Profile page (which shipped with the phone field read-only, pending this
feature):**

1. **Self-service (own number) uses the same OTP flow, scoped to self — not a separate mechanism.**
   The Profile page's "change my own phone" and the admin-side "change a client's phone" are the
   same underlying capability (duplicate-check + unique constraint + OTP-to-new-number +
   `clients.changePhoneNumber` permission + audit log) with two entry points: self (`ClientId` =
   the caller) and admin-on-behalf-of-another. One implementation, not two.
2. **No OTP exemption for Role=1 (Administrator), confirmed.** Sabry initially proposed exempting
   Administrators from the OTP step ("هو أصلاً مسؤول النظام"). Rejected on the recommendation
   below, which Sabry accepted: OTP-to-new-number defends against a *hijacked session* (stolen
   token, XSS, an unattended unlocked machine), not against the account owner's own intent —
   trusting the role more doesn't reduce that risk, and Administrator accounts are the
   highest-value target for exactly that kind of takeover. The control is uniform across every
   role that holds `clients.changePhoneNumber`, including Role=1.

**Added 2026-09-22, second follow-up (raised mid-implementation of an unrelated feature —
recorded here, not yet designed or built):**

3. **30-day cooldown between phone number changes.** A phone number may only be changed once
   every 30 days (from the previous change), for the same client — self-service and
   admin-on-behalf-of-another both count against the same cooldown. Needs a "last changed at"
   timestamp on `Clients` (new column, migration) and a check before allowing a new change
   request (both at the "request OTP" step and the "confirm" step, so the window can't be raced).
   Not yet designed: exact UX for showing "you can change your number again on `<date>`",
   whether Role=1 can override the cooldown for a client in a support scenario (needs its own
   permission if so — do not assume yes).

4. **The KeyAccount historical lead-inbox match is a real, verified break — not the "opposite
   risk" language used earlier in this ADR's Context section.** Re-verified 2026-09-22 by reading
   `_Server/Repository/KeyAccount.js:13-55` directly: `KeyAccountRepository.Index` queries
   `ContactTracker` with `ConTrackerContact: { [Op.like]: \`${ClientPhoneNumber} %\` } }` — a
   phone-number-prefix string match, **not** a `ConTrackerClientId` join. `ConTrackerContact` is
   written once at contact-creation time (`_RepoHelpers.js` `CreateContactTracker`,
   `${ContactNumber} - ${ContactName}`) and never updated afterward. So: the general
   `ContactTracker`/`ClientHistory`/`DiscountRequests`/`Consultations` flows genuinely are safe
   (they join live on `ClientId`, confirmed) — but this ONE read path
   (`KeyAccountRepository.Index`, the key-account's own historical lead inbox) is a frozen
   phone-number snapshot that **will** silently stop matching the moment that client's phone
   number changes. Sabry's concern is confirmed correct, not a false alarm.
   - Sabry's explicit requirements for fixing this properly (not deferring again):
     - `ContactTracker` and the History tables are expected to reach **millions of rows** — any
       fix must not do a synchronous bulk rewrite in the request path.
     - Must be **crash-safe / resumable**: if the server stops mid-migration, work already done
       must be recorded (checkpoint/cursor, not re-derived from scratch) so it can resume rather
       than restart or corrupt state.
     - Must run as a **background process**, and must **not lock the large tables** while
       updating them — the app is live and serving traffic concurrently.
   - Not yet designed. This project already has a cron/job infrastructure to build on:
     `_Server/Jobs/index.js` (`SchedulerManager`, node-cron based) with one `*Job.js` class per
     job (see `ConsultationReminderJob`, `PaymentReminderJob` for the existing pattern) — a new
     `PhoneNumberBackfillJob` (or similar) is the natural vehicle, not a request-time operation.
     Likely shape: on confirmed phone change, enqueue a backfill task (small tracking row: old
     number, new number, ClientId, status, cursor) rather than doing the rewrite inline; a cron
     job processes pending tasks in small batches (`LIMIT`-bounded `UPDATE`s or reads), advancing
     and persisting the cursor after each batch so a crash mid-run loses at most one batch, not
     the whole migration. Needs its own design pass before implementation — not decided by this
     ADR yet.

**Status:** items 1–2 above are decided, and their UX is now designed below. Item 3 (cooldown) is
now designed below. Item 4 is designed further below. **Nothing under this ADR is built yet.**

## Items 1–2 — Designed 2026-09-22: OTP flow UX

Grounded in the OTP infrastructure that already exists and ships today (`_Server/Repository/
Auth.js` `Forget`/`Reset`/`Verify`, plus the retry/resend gate in `_RepoHelpers.js`
`ProcessAccountActivation`) — read directly, not assumed:

- OTP is an 8-digit code (`Encryption.RandomNumber(8)`), delivered over WhatsApp
  (`WhatsappSender.SendOtp`), 15-minute expiry on first send.
- Resend is capped at **3 total sends** per OTP cycle (`ClientOtpRetryCount < 2` — 0, 1, 2 = 3
  sends allowed), then hard-blocked with `Client_RESEND_LIMIT` (403) until the cycle resets on a
  successful verify. No cooldown timer, just a count. This flow reuses the exact same cap — not a
  new number invented for this feature.
- **No frontend OTP-entry UI exists anywhere in this codebase today** — checked both
  `adham-dashbord/src` and `AdhamFathallah/src`, zero matches. This is genuinely new UI, not a
  restyle of an existing screen.
- **Confirmed, not assumed: `ClientPhoneNumber` is also the login credential** — `Auth.js:112-119`
  resolves login by `ClientPhoneNumber OR ClientPhoneNumber2`. A self-service phone change
  therefore changes what the client logs in *with*, not just a profile field. The design below
  accounts for that explicitly (see the confirmation-screen copy requirement).

**New `Clients` columns (migration, additive/nullable — same idempotent pattern as the rest of
this ADR):**

- `ClientPhoneChangePendingNumber` — the new number, held only during the OTP window.
- `ClientPhoneChangeOtp` / `ClientPhoneChangeOtpExpiry` — purpose-scoped, deliberately **not**
  reusing `ClientOtp`/`ClientForgetOtp`. Sharing a field with registration-verify or
  forgot-password would let one in-flight OTP purpose silently invalidate another for the same
  client (e.g. a client mid-password-reset who also triggers a phone-change request).
- `ClientPhoneChangeRetryCount` — mirrors `ClientOtpRetryCount`, same 3-send cap logic, **with one
  deliberate difference: it must have a reset path.** The registration flow's identical hard-block
  is survivable because completing verification is the whole point of that flow — there's always a
  way out. Here, a client who burns all 3 sends and never confirms would otherwise be permanently
  unable to ever change their number again, which is a dead end, not a safety control. **Rule: a
  fresh Start request clears `ClientPhoneChangeRetryCount` to 0 whenever
  `ClientPhoneChangeOtpExpiry` has already passed** (the prior cycle is dead, there's nothing left
  to protect by keeping the count). A fresh Start while the *previous* cycle is still live (not yet
  expired) does not reset it — that would just let someone brute-force around the cap by spamming
  Start.
- `LastPhoneChangeAt` — nullable, set only on a *successful* confirm. Doubles as the cooldown
  anchor for Item 3 below — one column, two features, no duplication.

**Uniqueness check — must span both phone columns, correctly this time.** The newly-found gap in
baseline fix #2 above (`Register`/`Update` only same-column-matching, missing the
`ClientPhoneNumber`-vs-`ClientPhoneNumber2` cross case) must **not** be repeated here: Start and
Confirm both check the candidate new number against *every other client's* `ClientPhoneNumber`
**and** `ClientPhoneNumber2` (`Op.or` across both columns, `ClientId: {[Op.ne]: :id}`) — one
correct check, reused at both steps.

**Permission gating — self vs. on-behalf are different authorization tiers, not the same gate
with two callers.** `clients.changePhoneNumber` (baseline fix #3) is designed Administrator-only by
default, same precedent as `clients.whitelist` (Role 2/Moderator and Role 3/Support don't hold it
unless explicitly granted — checked directly against `Permissions.js`'s `RESOURCE_ACTIONS`/
`ROLE_PERMISSIONS`). But the Profile page (self-service) is reachable by *any* logged-in role,
including Role 3/Support — gating self-service phone change behind an Administrator-only
permission would 403 ordinary staff trying to do a completely mundane thing (update their own
login number). **Fix: self-service is exempt from the `clients.changePhoneNumber` check —
`:id === req.Client.ClientId` bypasses the resource-permission gate specifically, nothing else.**
Every other control still applies unchanged to the self path (OTP-to-new-number, cooldown,
cross-column uniqueness, active-backfill-task guard, audit log) — the permission is what
distinguishes "acting on someone else's identity" from "acting on your own," and only the former
needs the elevated gate. This mirrors how `payments` is already described as "hybrid owner-or-
admin" in `Permissions.js`'s resource comments — not a new authorization pattern for this codebase.

**Two endpoints, one for each step, reused identically for both entry points (self and
admin-on-behalf — one implementation per the 2026-09-22 "Resolved" decision above, not two):**

1. **Start** (`POST /clients/:id/phone-change/start`; gated by `clients.changePhoneNumber`
   **unless** `:id === req.Client.ClientId`, per the self-exemption above):
   - Validates the new number (format, `ProcessNumber` normalization, not equal to the current
     number, not already in use by another Client — the cross-column check above, not baseline
     fix #1/#2's narrower same-column version).
   - Rejects if the cooldown (Item 3) is active, or if an active `PhoneNumberBackfillTasks` row
     (`pending`/`running`) exists for this client (Item 4, point 6) — both checked here AND again
     at Confirm, so the window can't be raced between the two steps.
   - Generates the OTP, sends it to the **new** number (not the old one — this is what makes
     Option A close the takeover vector: proving control of the destination, not the source),
     stores the four pending-state columns above (resetting the retry count first if the prior
     cycle already expired, per the rule above).
   - Response carries only a masked form of the new number (e.g. last 3 digits) for the
     confirmation-step UI to echo back — never the OTP itself.
2. **Confirm** (`POST /clients/:id/phone-change/confirm`, same permission/self-exemption rule):
   - Validates the submitted code against `ClientPhoneChangeOtp`, checks expiry
     (`RepoHelpers.CheckCodeExpire`, reused as-is; 15 minutes, matching first-send — **not** the
     2-hour expiry `ProcessAccountActivation` uses on its resend branch elsewhere in this codebase;
     don't reuse that branch by reflex, it's a different, longer-lived flow).
   - Re-validates uniqueness/cooldown/active-backfill-task (the same three checks as Start) —
     defends against a race where another change completed during the OTP window.
   - On success, in **one transaction** (per Item 4 point 5): write the new
     `Clients.ClientPhoneNumber`, set `LastPhoneChangeAt = now()`, clear all four pending-state
     columns, insert the `PhoneNumberBackfillTasks` row, write the audit log (baseline fix #4).
     Single transaction means the phone change and the backfill task's existence can never
     diverge — no code path where the number changes but the task silently fails to get queued.
3. **Resend** — same endpoint shape as Start but keyed off the existing pending number rather than
   accepting a new one (changing the target number mid-cycle re-starts at Start, it does not
   resend); reuses the retry-count cap and its reset rule unchanged.

**Two-step modal UI** (new component — no existing pattern to extend, per the grep above):

- **Step 1 — enter new number.** Current number shown read-only for context. Inline validation
  errors: invalid format, same-as-current, already-in-use. Submit calls Start.
- **Step 2 — enter code.** Shows the masked destination ("code sent to •••••1234"), an 8-digit
  code input, a Resend link disabled while a cooldown-free resend is unavailable (server enforces
  the real cap; client just reflects remaining attempts so the user isn't surprised by the hard
  block), and Confirm.
- **Error states:** expired/invalid code → inline, stay on step 2; resend-limit hit → terminal
  state ("too many attempts, contact support" — no further retry in this modal, matches the
  existing `Client_RESEND_LIMIT` semantics rather than inventing new ones); OTP send failure
  (WhatsApp API error) at step 1 → inline error with a retry button, does not advance to step 2.
- **Success confirmation copy — the one genuinely new UX requirement this ADR surfaces:** must
  explicitly tell the client (self-service case) that this number is now also their **login**
  number, since that is not obvious from a "profile field changed" framing and the consequence
  (locking themselves out by trying to log in with the old number next time) is easy to hit by
  accident.
- **Preemptive gating, not just submit-time rejection:** the "Change Number" entry point itself
  (Profile page button / Client detail page button) is disabled with an inline reason when the
  cooldown is active or an active backfill task exists for that client — both signals should ride
  along on the same request that already fetches the profile/client detail data, as two
  independent fields: `PhoneChangeCooldownUntil: date | null` and
  `PhoneChangeBlockedByPendingBackfill: boolean` (see Item 3 below for why these stay two separate
  fields instead of one collapsed date) — not a separate round-trip.
- **Admin-on-behalf differences are copy-only, not logic-only:** title/body text says "change
  `{ClientName}`'s number" instead of "change your number"; the audit log's `actor` field
  distinguishes self vs. on-behalf per baseline fix #4. The OTP destination, the checks, and the
  transaction are identical in both cases — no special-casing.

## Item 3 — Designed 2026-09-22: 30-day cooldown UX

Uses `LastPhoneChangeAt` (the same column introduced above for Items 1–2 — no separate column
needed).

- **Window:** 30 days from `LastPhoneChangeAt`, shared between self-service and admin-on-behalf —
  one counter per client, not two, matching the already-decided requirement ("ذاتي وإداري
  بيشتركوا في نفس الـ cooldown").
- **Resolved 2026-09-22 — option (b), explicit separate override permission.** Sabry's original
  note on cooldown left this open explicitly ("do not assume yes"); decided in favor of a
  dedicated `clients.changePhoneNumber.override` permission (Administrator by default, granted
  like any other static role key — not automatically implied by `clients.changePhoneNumber`
  itself, so holding the base permission does not silently grant the override) rather than a
  blanket Role=1 exemption. When the caller holds the override permission, the cooldown check (and
  only the cooldown check — not the OTP step, not the cross-column uniqueness check, not the
  active-backfill-task guard, all of which stay universal with no exemption) is skipped for that
  request. The override use must still write the same `Logger.Warn("ClientPhoneNumberChanged",
  ...)` audit entry as every other change, with an additional `overrodeCooldown: true` field so
  the audit trail distinguishes an overridden change from a normal one at a glance.
- **No override *button* inside the standard modal, regardless.** The override permission changes
  what the backend allows, not the UI everyone sees — the ordinary Change Number modal never shows
  a "skip cooldown" affordance. An admin who holds the override permission and needs to use it
  does so by proceeding through the same Start/Confirm flow while the cooldown would otherwise
  block a non-privileged caller; the backend permits it silently rather than surfacing a distinct
  bypass control. Keeping the standard path visually identical for everyone avoids training
  ordinary admins to look for or expect a bypass option.
- **Surfaced preemptively, same mechanism as the backfill-task guard above:** the "Change Number"
  button is disabled with "you can change this again on `{date}`" rather than only failing after
  the admin/client already filled in a new number and hit submit. Exposed as the same two
  independent fields named under Items 1–2 above — `PhoneChangeCooldownUntil` and
  `PhoneChangeBlockedByPendingBackfill` — rather than one collapsed date, since the pending-backfill
  case has no fixed completion time to show and pretending it does would be misleading UI.
- **Enforced server-side at both Start and Confirm** (already specified above under Items 1–2) —
  the UI-level disabled button is a UX convenience, not the actual control; the real enforcement
  is the two backend checks, consistent with how the accepted-status lock on Job Applications was
  built (UI hides the action, but the 409 guard is what actually holds).

## Item 4 — Designed 2026-09-22: `PhoneNumberBackfillJob`

Design-only pass, requested explicitly before any implementation of the Phone Number feature
itself. Grounded in the live dev DB (`futureso_master`, read-only queries), not assumption:

**Scope check — "History" tables are NOT affected, narrower than Sabry's original flag:**
Queried the two tables in this DB actually named `*istory*`: `ClientHistory`
(`HistoryClientId` FK, 6,498 rows) and `SearchHistory` (`ClientId` FK, 24 rows). Both store
**no phone number at all** — they already join live on `ClientId`, confirming the ADR's earlier
"Checked and NOT a concern" claim for the general case. **Only `ContactTracker`'s
`KeyAccountRepository.Index` read path needs this job.** No migration touches `ClientHistory`/
`SearchHistory` under this design.

**Root cause, reconfirmed with schema, not just code reading:** `ContactTracker` has no FK from
a row to "the key account that was contacted" — `ConTrackerClientId` (confirmed present via
`DESCRIBE`) is the ID of the **caller/lead**, not the callee; `Contacts` (the callee identity
table) has no `ClientId` column at all, only `ContactNumber`. So `ConTrackerContact`
(`"{Number} - {Name}"`, frozen at write time, matched via `LIKE` in `KeyAccountRepository.Index`)
is genuinely the only signal tying a historical contact-tracker row to a key account, and it can
only be kept correct by rewriting it when that key account's phone changes. Adding a proper FK
(e.g. `Contacts.OwnerClientId`) would be the deeper structural fix — but it touches an unrelated
table/concept (how "is this Contact linked to a real Client account" gets established at all,
today nothing does) and is **out of scope for a phone-number-change ticket**; noted as a future
improvement, not bundled in here.

**Also found, current-state (independent of this feature):** `SHOW INDEX FROM ContactTracker`
returns only the `PRIMARY` key — no index on `ConTrackerContact` at all. `KeyAccountRepository
.Index`'s existing `LIKE '{phone} %'` query is *already* a full table scan today, before any of
this ships. 184 rows currently (dev), so invisible now; will not stay invisible at "millions of
rows" scale, independent of whether the backfill job ever runs. The fix below's migration adds
this index regardless, since both the existing read path and the new backfill batches need it.

**The design:**

1. **Migration — add an index on `ContactTracker.ConTrackerContact`.** Fixes the existing
   full-scan read path and makes the backfill's own `WHERE ... LIKE` batches index-assisted
   instead of full scans. Checked `SHOW TABLE STATUS LIKE 'ContactTracker'`: `Row_format` is
   `Dynamic`, so the 3072-byte InnoDB prefix-index limit applies (not the old 767-byte COMPACT
   limit) — a full-column index on this `VARCHAR(255)` utf8mb4 column (1020 bytes worst case)
   fits without issue. A `ConTrackerContact(32)` prefix index would still be smaller on disk and
   fully covers the phone-number prefix the `LIKE` queries match on — a minor size optimization,
   not a correctness requirement either way.
2. **Migration — new small table `PhoneNumberBackfillTasks`** (`TaskId` PK, `ClientId`,
   `OldPhoneNumber`, `NewPhoneNumber`, `Status` ENUM(pending/running/completed/failed),
   `RowsUpdated`, `CreatedAt`/`UpdatedAt`/`CompletedAt`). **This table is for observability only
   — it is not load-bearing for correctness** (see point 3): even if a write to it failed, the
   underlying data rewrite is still safe and eventually completes on its own.
3. **The rewrite is self-terminating and needs no persisted cursor — this is the load-bearing
   design choice:**
   ```sql
   UPDATE ContactTracker
   SET ConTrackerContact = CONCAT(:newNumber, SUBSTRING(ConTrackerContact, LENGTH(:oldNumber) + 1))
   WHERE ConTrackerContact LIKE CONCAT(:oldNumber, ' %')
   LIMIT :batchSize;  -- e.g. 500
   ```
   `ConTrackerContact` is stored as `"{Number} - {Name}"` (confirmed via `_RepoHelpers.js`
   `CreateContactTracker`, line ~514 — built at write time from the *submitter's own*
   `ParsedContact.ContactNumber`/`ContactName`, never from `ClientData.ClientPhoneNumber` or from
   `Contacts.ContactNumber` — so future rows are unaffected by this backfill and need no
   synchronization). The `SUBSTRING(..., LENGTH(:oldNumber) + 1)` splice is what preserves the
   `" - {Name}"` tail instead of a naive `SET ConTrackerContact = :newNumber`, which would both
   destroy the stored name and produce a value that no longer matches `LIKE 'newNumber %'` (the
   query in `KeyAccountRepository.Index` needs that trailing-space-delimited prefix). **Verified
   against live dev data, not just reasoned about:** ran the exact `CONCAT`/`SUBSTRING`
   expression read-only against a real row (`201069017890 - Sabry Daood`) — output
   `201000000000 - Sabry Daood`, and `... LIKE '201000000000 %'` evaluated to `1`. Confirms both
   that the name survives and that the rewritten row re-matches the new prefix pattern.
   Once a row is rewritten it starts with `newNumber`, so it can never match its own `WHERE`
   clause again. Re-running the *exact same statement* after a crash mid-run is always safe: it
   can only touch not-yet-converted rows, never double-applies, and needs no separately-tracked
   cursor to resume correctly — satisfies Sabry's "crash-safe/resumable, cache the process state"
   requirement by construction, not by a hand-rolled checkpoint (simpler, fewer failure modes).
   `LIMIT` bounds each statement to a short row-level lock, never a whole-table lock, and no
   single transaction ever spans more than one batch — satisfies "no lock on the big tables while
   the app is live."
   **Implementation detail for the job class:** prefer a two-step batch over the single combined
   statement above — `SELECT ConTrackerId FROM ContactTracker WHERE ConTrackerContact LIKE
   CONCAT(:oldNumber, ' %') LIMIT :batchSize`, then `UPDATE ContactTracker SET ConTrackerContact
   = CONCAT(...) WHERE ConTrackerId IN (:ids)`. This keeps the `LIKE` range scan isolated to the
   read (so its index usage is unambiguous) and the write as a plain PK-indexed update. The
   self-terminating/idempotent property is unchanged — the `LIKE` filter still only ever lives on
   the SELECT, so a crash between the two steps just means the next run re-selects the same
   not-yet-converted rows.
4. **Job class:** `PhoneNumberBackfillJob` in `_Server/Jobs/`, same shape as the existing
   `Est8CoreOutboxJob`/`ConsultationReminderJob` (`static async execute()`, small `BATCH`
   constant, registered in `SchedulerManager` behind its own env flag + interval — same pattern
   as every other job there, nothing new invented).
5. **Trigger:** on a *confirmed* phone-number change (after OTP verify — hooks into the not-yet-
   built item 1/2 flow), insert one `PhoneNumberBackfillTasks` row in the **same transaction** as
   the `Clients.ClientPhoneNumber` write, so the task can never be silently lost if the request
   crashes right after the phone change commits.
6. **New finding from this design pass — sequencing guard, not previously identified:** because
   the rewrite keys off `OldPhoneNumber`, two overlapping backfills for the *same* client (a
   second phone change fired before the first backfill fully drains) could miss rows, leaving
   some historical rows stuck on an intermediate number instead of the final one. The 30-day
   cooldown (item 3) makes this rare but does not make it impossible (a large historical inbox
   could still be draining when the cooldown reopens). **The "confirm new phone" step must check
   for an active task** (`PhoneNumberBackfillTasks` with `Status IN ('pending','running')` for
   that `ClientId`) and reject the change until it completes — a second guard alongside the
   cooldown check, cheap to implement, closes a real correctness gap.
7. **Hard dependency:** this backfill's safety assumes phone-number uniqueness (baseline fix #2
   above) — otherwise `LIKE 'oldNumber %'` could rewrite another client's historical rows if two
   clients ever shared that number pre-constraint. Recommend a one-time duplicate-phone report
   run before enabling this flow in production (operational check, not a blocking migration).
8. **Explicitly out of scope, checked not to be a hidden dependency of this job:** `Contacts`
   (the table behind `Client.js`'s `IsKeyAccount`/`IsTeam` computed flag, matched via
   `Con.ContactNumber = ClientPhoneNumber`) is a *different* table from `ContactTracker` and this
   backfill does not touch it. Checked live: 3 rows total, no `CreatedAt`/`UpdatedAt` columns at
   all, and zero `Contact.create`/`.bulkCreate`/`.findOrCreate` calls anywhere in `_Server` —
   nothing in this codebase writes to it today. It is externally-managed or legacy/frozen already,
   independent of whether this feature ships. `IsKeyAccount` desync on phone change remains the
   separately-accepted risk already logged under Consequences below — this job does not make it
   worse and is not responsible for fixing it.

**Status:** built (2026-09-22). See "حالة التنفيذ" at the end, including the deviation from
"cron-only" in this section.

## Consequences

- ✅ Closes the account-collision bug that exists today regardless of this feature request.
- ✅ Phone-number changes become attributable (audit log) either way.
- ⚠️ **Frozen `ContactTracker` snapshots for key accounts are not migrated by either option** — a
  phone edit permanently orphans historical lead-inbox matching for that client. Fixing this would
  mean also rewriting historical `ContactTracker` rows on every phone change, which was judged
  out of scope for v1 (increases blast radius of an already-sensitive write). Documented, not solved.
- ⚠️ Blacklist rows created without `BlacklistUserId` (manual/imported entries, matched by number
  only) will not follow a phone change — pre-existing behavior, unchanged by either option.
- ⚠️ Option A adds real engineering (new OTP purpose/endpoint, new UI step) vs. Option B's smaller
  diff — cost/benefit is Sabry's call.

## Alternatives rejected

- Leaving the field silently editable as-is (status quo) — rejected outright: the duplicate-check
  bug + no unique constraint is a live account-collision bug independent of any new feature; must be
  fixed regardless of which option ships.
- Making the field fully read-only / removing edit capability entirely — rejected: Sabry explicitly
  asked for this capability, and it's a legitimate support need (clients do change numbers).

## Verified

Findings above come from a full-repository grep/read pass across `AdhamFathallah/_Server` and
`AdhamFathallah/src` (see agent transcript, 2026-09-22) — not yet verified against a running
instance or with test data. No code has been written for this decision yet.

**Item 4 design pass, 2026-09-22, additionally verified with live read-only queries** (see that
section above for each): `ClientHistory`/`SearchHistory` schema (no phone column), `ContactTracker`
index list (PRIMARY only) and row format (`Dynamic`), the `CONCAT`/`SUBSTRING` rewrite expression
run against a real row and re-matched against its own new `LIKE` pattern, and the `Contacts` table
row count/schema/writer-search. All read-only — no writes made to the shared dev database.

---

## حالة التنفيذ (2026-09-22)

**اتبنى كله (البنود 1–4):**

- **Backend:**
  - Migrations: 033 (`ClientForgetVerifiedUntil` لإصلاح SEC-1) و034 (`ClientPhoneChanges` + prefix index على `ConTrackerContact`).
  - `Repository/PhoneChange.js`: Start / Resend / Confirm / RemoveSecondary / StatusFor.
  - مسارات إدارية `/admin/clients/phone/*` ومسارات ذاتية `/profile/phone/*`.
  - الصلاحيتين `clients.changePhoneNumber` و`clients.overridePhoneCooldown`.
  - `PhoneNumberBackfillJob`.
  - `Client.Update` بيرفض أي تغيير في الرقم (`409 PHONE_CHANGE_REQUIRES_OTP`).
- **Frontend:**
  - `PhoneChangeModal` + `PhoneChangeNotice` مشتركين.
  - `ClientContactSection` في صفحة العميل.
  - كارت "أرقام الهاتف" في البروفايل.
  - `EditClientModal` بقى بيعرض الأرقام للقراءة بس وما بيبعتهاش.

**انحرافات عن التصميم أعلاه (بقصد):**

1. **الـ backfill مش معتمد على الـ cron لوحده.**
   - فلاجات الـ cron الاتنين (`SCHEDULER_ENABLED` و`PHONE_BACKFILL_ENABLED`) افتراضيهم `"false"`، ولو الـ task ما اتنفذتش العميل بيتقفل للأبد.
   - الحل: `Confirm` بيشغّل الـ job فوراً، وأي طلب بيترفض بسبب backfill معلّق بيشغّله برضه (self-heal).
   - الـ cron بقى backstop بس، للتاريخ الكبير أوي وللـ tasks اللي اتعلّقت.
   - نفس الدرس الموثّق في `Est8CoreLeadSync`.
2. **استرجاع الـ task المعلّقة:**
   - task في حالة `running` وآخر تحديث ليها من أكتر من 15 دقيقة (restart لـ pm2 في النص) بتترجع تتنفذ.
   - الـ `UPDATE` بقى بيعيد فحص `LIKE 'old %'`، فلو اتنفذ مرتين على نفس الصفوف مبيعملش حاجة تانية.
   - **اتأكد تجريبياً** (test client 81، أرقام وهمية، كل حاجة اترجعت): الـ task القديمة اتنفذت (3 صفوف والاسم محفوظ)، والـ task الجديدة فضلت زي ما هي، ومفيش أي بقايا.
3. **قاعدة حسابات الـ staff = `admins.manage`، مش "هل الفاعل staff".**
   - الشرط الأول ما كانش بيشتغل خالص: `RequireAdminAuth` بيقبل 1/2/3/8 = `StaffRoleIds`.
   - التفاصيل في SEC-2 في `docs/Security-Findings-2026-09-22.md`.

**E2E في المتصفح — اتعمل 2026-09-22** (العميل 81، من غير أي واتساب، وكل حاجة اترجعت للحالة الأصلية):

- **وضع التجربة:** فلاج `PHONE_CHANGE_OTP_DEV_LOG=true` بيكتب الكود في اللوج بدل ما يبعته.
  - مقفول تماماً لو `NODE_ENV=production`.
  - بيعلن عن نفسه وقت تشغيل السيرفر في `General/PhoneChangeOtpDevLogEnabled`، واتأكدت من ده قبل أي إرسال.
- **اللي اتجرّب ونجح:**
  - رقم مستخدم ← 409.
  - بدء التغيير، والرقم ظاهر مخفي.
  - إعادة الإرسال بتلغي الكود القديم.
  - كود غلط ← 400 بالعربي، من غير logout.
  - كود صح ← الرقم اتغيّر، والـ backfill اشتغل فوراً وعدّل صفين مع الحفاظ على الاسم.
  - فترة الانتظار ← 429 ومعاه التاريخ.
  - تجاوز فترة الانتظار ← الرقم الثاني اتضاف و`OverrodeCooldown=1` اتسجّل.
  - إزالة الرقم الثاني.
  - باسورد غلط في مسار البروفايل ← 422، والطلب فيه `Target`.
- **اتصلح أثناء الاختبار:**
  - رسايل الكود الغلط والمنتهي كانت بالإنجليزي، لأن المفاتيح العامة `INVALID_CODE`/`CODE_EXPIRED` في `ar.js` مش مترجمة. اتعمل مفتاحين خاصين بالفيتشر، والمفاتيح العامة ما اتلمستش لأن الموبايل بيستخدمها.
  - تنبيه "الـ backfill لسه شغّال" كان بيفضل ظاهر بعد ما يخلص. الصفحة بقت بتعمل polling كل 4 ثواني طول ما فيه backfill معلّق.

- **حساب Moderator مؤقت (#84) — اتعمل، واتمسح بعد الاختبار:**
  - تأكيد تغيير الرقم من البروفايل ← الجلسة اتمسحت، وحوّل لـ `/login`، وتسجيل الدخول بالرقم الجديد اشتغل.
  - قاعدة الـ staff بطلبات حقيقية كشفت فشلة تانية: `toJSON()` مفيهوش `ClientRoleId`. اتصلحت واتأكدت. التفاصيل في SEC-2.

**المتبقي:**
- **الفلاج في `.env` المحلي:** لازم `PHONE_CHANGE_OTP_DEV_LOG` يتشال و`NODE_ENV` يرجع زي ما كان بعد الاختبار.
- **حساب Moderator حقيقي:** قاعدة `admins.manage` اتأكدت بمحاكاة منطقية بس، مش بطلب فعلي.
- **`Backend/Free`:** نسخة SEC-1 هناك ما اتصلحتش.
