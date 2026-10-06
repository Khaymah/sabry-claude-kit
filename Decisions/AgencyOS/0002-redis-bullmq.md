# ADR-0002 — Redis + BullMQ as the SaaS Infra Spine (supersedes DB-backed jobs)

**Status:** ACCEPTED — decided by Sabry (2026-06-03)
**Date:** 2026-06-03
**Author:** Engineering (Claude) — proposed Option 1 (abstraction); Sabry chose Option 3 (Redis-first)
**Related:** V4-PLAN §0 (د7) · F0 SaaS Infra Spine · CLAUDE.md §3/§9 (updated) · `Core/Jobs/*` · `Notifications.Hub.ts` · `RateLimit.Middleware.ts` · `Env.ts:44`

---

## Context

The locked stack (CLAUDE.md §3) chose **DB-backed jobs** (`Core/Jobs`: `setInterval` poller + `ClaimDueJobs` with `FOR UPDATE SKIP LOCKED`) and made **Redis/BullMQ optional**, because the local dev Redis was old (no RESP3 — CLAUDE.md §9 gotcha #3). Code audit (2026-06-03) confirmed the SaaS-readiness gaps:

- **No caching layer** anywhere — `LoadOrgRole` hits the DB on *every* authenticated request (membership + role + permissions).
- `Notifications.Hub` (in-memory `Map`) is not wired to any SSE transport; the comment itself says *"a multi-instance deployment would back this with Redis pub/sub."*
- `EventBus` and `RateLimit.Middleware` are in-process `Map`s → break across instances.
- `REDIS_URL` exists in `Env.ts:44` with a silent default but is **unused**.

Two options were presented:
- **Option 1** — abstraction layer (`Cache`/`PubSub`/`RateLimitStore`) with in-process↔Redis impls, Redis OFF by default, DB queue kept. (Engineering recommendation — preserves dual-track simplicity.)
- **Option 3** — Redis-first: Redis mandatory for all, BullMQ replaces the DB queue, single code path.

**Sabry chose Option 3.** Engineering surfaced the trade-offs (breaks self-hosted "zero-infra"; requires modern Redis vs the documented old-Redis gotcha) before proceeding — Sabry confirmed.

---

## Decision

### 1. Redis is a mandatory dependency (via ENV)

- `REDIS_URL` becomes **required** in `Env.ts` (Zod, **no silent default** — fail fast if missing). The deployer MUST provide connection data; they are free to choose the target (docker / managed / own server).
- Provided in **both** deployment paths: a Redis 7 service in `docker-compose`, **and** documented for PM2/bare-metal (install Redis 7). Mirrors the existing dual-deploy model ("every connection via ENV").

### 2. BullMQ replaces DB-backed jobs (migration)

- Migrate `Core/Jobs` (`Worker.ts` `setInterval` + `Jobs.Service.ts` `ClaimDueJobs`) → BullMQ queues + workers.
- All jobs migrate: meeting pipeline · scheduled updates · backups · any scheduled work.
- The worker becomes a **separate BullMQ worker process** (resolves the prior "worker runs inside `Bun.serve`" event-loop risk — `Server.ts:21`).
- The old "DB clock vs client clock" scheduling gotcha is handled by BullMQ's Redis-based delay mechanism.

**Sequencing (added after advisor review):** the BullMQ migration is **NOT** part of the early infra spine. Additive Redis (cache / pub-sub / rate-limit / SSE fan-out) lands first — it removes no working code. The DB-backed `Core/Jobs` keeps running until the jobs it serves actually matter (the AI pipeline is degraded/keyless and scheduled-updates are Markdown-only today). The migration happens in V4-PLAN P3, where the AI pipeline + multi-channel scheduled-updates are built **directly on BullMQ** and the few existing job types migrate alongside. This avoids replacing a working queue for features that don't exist yet.

### 3. Cache / PubSub / RateLimit move to Redis

- **Cache:** `LoadOrgRole` hot-path (short TTL + invalidation on role change) · Stats endpoints · SystemSettings · catalogs.
- **PubSub:** `EventBus` + `Notifications.Hub` → Redis pub/sub (enables multi-instance SSE fan-out + SystemSettings hot-reload invalidation).
- **RateLimit:** `RateLimit.Middleware` → Redis (INCR + EXPIRE) — limits consistent across instances.

### 4. What does NOT change (invariants)

- **RLS untouched.** Tenant isolation stays at the DB layer (`agencyos_app` + `app.org_id`). Redis holds no authoritative tenant boundary; cache keys are namespaced by `OrgId`.
- **No secrets in code.** `REDIS_URL` via ENV only.
- **PascalCase, module boundaries, soft-delete, etc.** unchanged.

---

## Consequences

- **Self-hosted "zero-infra" is lost** — self-hosters must run Redis (acceptable: one `docker-compose` service, or documented PM2 install). The dual-track ROADMAP framing updates to "Redis via compose."
- **Dev environment must use modern Redis 7** (the old local Redis is unusable for BullMQ) → docker Redis for dev.
- **Single code path** (no in-process fallback to maintain) — simpler than Option 1, at the cost of the mandatory dependency.
- **CI must test the Redis/BullMQ path** (spin a Redis container) — a job must actually execute through the queue before "done" (V4-PLAN §0.2 live-verification rule).
- **Observability gain:** Bull Board + BullMQ retries/priorities/delayed jobs out of the box.

---

## Supersedes

- CLAUDE.md §3 row "Jobs/Scheduling: DB-backed — لا BullMQ/Redis إلزامي" → **now BullMQ + Redis (mandatory).**
- CLAUDE.md §9 gotcha #3 "Redis المحلي قديم → الجدولة DB-backed" → **now: use Redis 7 (docker); old local Redis retired.**
- CLAUDE.md §3 "Realtime: SSE" → unchanged in transport, but fan-out now backed by Redis pub/sub.
