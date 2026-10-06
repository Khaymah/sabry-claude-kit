# ADR-0007 — Phase C infrastructure: native WebSocket + in-process Event Bus + BullMQ/Redis queue

- **Status:** Accepted
- **Date:** 2026-06-12
- **Project:** Est8Core
- **Relates / builds on:** `.Pm/modules/11-Notifications.md` (N1/N2/N3/N6 — authoritative), `.Pm/modules/10-WhatsApp.md` (Inbox real-time + webhook), `.Pm/modules/12-Export.md` (E1 queue), `.Pm/08-Phase1-Foundations-Design.md`, `.Pm/14-PhaseC-Foundations-Plan.md` (execution). Reconsiders the lean-infra stance of [ADR-0001](./0001-token-denylist-db-over-redis.md) for the queue specifically.

## Context

Phase C (communication/interaction) is the next blocked layer: four consumers depend on shared
real-time + background-job foundations that don't exist yet — **K4 unified timeline** (auto-log
WhatsApp/email into a contact timeline), **WhatsApp Inbox** (live inbound conversations),
**Notifications + WS** (real-time in-app + scheduled reminders), and **Export async** (background
export jobs, today a synchronous "async" lie that OOMs on large datasets).

The architecture was already settled in `.Pm/modules/` (Sabry, 2026-06-09/11): real-time =
**WebSocket** (N1), dispatch = **in-process Event Bus** (N2), queue = **BullMQ + Redis** (N6/E1,
shared between Notifications and Export). A discovery pass for this ADR clarified that the Redis
dependency is **not uniform**: N1 (WebSocket) and N2 (Event Bus) need **no external infrastructure**
at single-instance scale, so two-thirds of Phase C is unblocked immediately. Only the **queue
substrate** was a genuinely open operational fork — `.Pm/modules/12` E1 itself lists "queue على DB"
as an acceptable alternative, and [ADR-0001] set a "Postgres-over-Redis" precedent.

The fork was put to Sabry (2026-06-12): **pg-boss/Postgres (no new infra)** vs **BullMQ + Redis
(the settled default)**. Decision: **BullMQ + Redis** — accept the managed-Redis dependency for
battle-tested throughput, visibility, and horizontal scale.

## Decision

**1. Real-time = native WebSocket (no Redis).** `Core/WebSocket/WS.Manager.ts` holds a
`Map<\`${tenantId}:${userId}\`, Set<WS>>` with `RegisterWS` / `BroadcastToUser` /
`BroadcastToTenant`, plus a `GET /api/v1/ws` upgrade route (authenticated; tenant + user resolved
from the access token). Single-instance for now; multi-instance fan-out (Redis pub/sub backplane)
is deferred behind the manager seam. Events: `notification.new`, `notification.unread`,
`conversation.new`, `lead.assigned`.

**2. Dispatch = in-process Event Bus (no Redis).** `Core/Events/Event.Bus.ts` — `on(event, handler)`
+ `emit(event, payload)` implemented as **`await Promise.allSettled`** (NOT fire-and-forget, so a
handler failure is observable and never silently dropped). Modules emit domain events;
`Notifications.Service` registers handlers → `DispatchNotification` (insert in-app row →
`BroadcastToUser` → channel adapters per user preference). This stays in-process by design — it is
integrity-adjacent glue inside the modular monolith, not a cross-service bus.

**3. Queue = BullMQ + ioredis (Redis).** `Core/Queue/Queue.Worker.ts` behind an **`IQueue`
interface** (the same swappable-seam pattern as `IStorageProvider`): separate queues
(`notifications`, `exports`), repeatable/cron jobs (e.g. `check_overdue_leads` 08:00), delayed jobs
for reminders (installments, follow-ups). Redis is provisioned as a managed instance; connection via
`REDIS_URL` env. The `IQueue` seam keeps BullMQ swappable and lets tests run against an in-memory
fake without Redis.

**4. Sequencing (unblock without waiting on Redis).** N2 (Event Bus) and N1 (WebSocket) are built
**first** — zero infra, they immediately unblock real-time notifications, timeline auto-log (K4),
and WhatsApp-inbox live push. The Queue (N6) lands once `REDIS_URL` is provisioned; Export async
(E2) and scheduled reminders depend on it. WhatsApp **webhook ingestion** (inbound, `POST
/api/v1/whatsapp/webhook`) is HTTP-only and also infra-free.

## Consequences

- Two-thirds of Phase C (real-time + dispatch) ships with **no new managed infrastructure**; the
  app keeps a single external dependency surface until the queue lands.
- The **queue introduces Redis** as a new managed dependency — an operational/cost addition and a
  deliberate exception to ADR-0001's Postgres-over-Redis stance, scoped to **background jobs** (where
  BullMQ's maturity and delayed/repeatable-job ergonomics justify it), not to request-path state.
- WebSocket is **single-instance** until a Redis pub/sub backplane is added behind `WS.Manager`;
  horizontal scaling of the WS tier is a tracked follow-up, not a blocker for early customers.
- `REDIS_URL` becomes a **hard runtime dependency** for the worker process (Export async + reminders
  fail closed without it). The web process degrades gracefully (real-time still works; queued jobs
  pend).
- The `IQueue` seam keeps the substrate swappable (BullMQ ⇄ pg-boss/in-memory) and makes the worker
  unit-testable without Redis.

## Alternatives considered

- **pg-boss / Postgres-backed queue (no new infra)** — recommended by CTO for lean-infra consistency
  (ADR-0001) and allowed by `.Pm/modules/12` E1; **rejected by Sabry** in favor of BullMQ+Redis for
  throughput, visibility, and horizontal scale headroom. Kept as the documented fallback behind
  `IQueue`.
- **Redis pub/sub for the Event Bus / cross-instance now** — deferred: in-process
  `Promise.allSettled` is sufficient for a single-instance modular monolith and avoids coupling
  domain dispatch to Redis availability.
- **Fire-and-forget event emit** — rejected: a dropped notification/timeline write would be
  invisible; `await Promise.allSettled` surfaces handler failures.
- **Multi-instance WebSocket with a backplane from day one** — deferred: single-instance covers
  early scale; the backplane slots behind `WS.Manager` when load demands it.
