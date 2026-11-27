# PostgreSQL operations on a small VPS

- **Situation:** "too many connections", app slows under load, "do we need pgbouncer", table bloat, slow queries to find, tune Postgres for a 2–8 GB VPS, upgrade Postgres to a new major.
- **Skip when:** managed Postgres where the provider tunes and upgrades it; schema and query design are in `Stacks/Database.md`.
- **Decision:** keep Postgres on defaults tuned to the RAM (a short list of settings), cap connections at the app pool, add pgbouncer only when connections are the proven bottleneck, log slow queries from day one, watch autovacuum, and upgrade by `pg_upgrade` or dump-restore into a new cluster after a rehearsal.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Tuned memory settings, localhost-only, pool size set, slow query log on |
| Standard | Production: `pg_stat_statements`, autovacuum monitored, connection budget, `statement_timeout`, upgrade rehearsal |
| Advanced | Many app instances or heavy load: pgbouncer transaction mode, streaming replica, partitioning, `pg_repack` |

## Rules

### Minimum — always, never cut

- `listen_addresses = 'localhost'`; `pg_hba.conf` allows only `local` and `127.0.0.1/32` with `scram-sha-256`. Remote admin goes through an SSH tunnel.
- Connection budget: `max_connections = 100` default is fine. App pool size × app instances (two during blue/green, `devops/deploy-zero-downtime.md`) + 10 for admin and migrations must stay under it. Pool size is 10–20, not 100.
- Memory for a VPS with RAM `R` shared with the app: `shared_buffers = R/4`, `effective_cache_size = R/2`, `work_mem = 16MB` (not 256MB: it is per sort per connection), `maintenance_work_mem = 256MB`.
- SSD settings: `random_page_cost = 1.1`, `effective_io_concurrency = 200`.
- `log_min_duration_statement = 500` (ms) so slow queries are written to the log; `log_lock_waits = on`; `idle_in_transaction_session_timeout = '60s'`.
- Set the database time zone to UTC and store `timestamptz` (`backend/data/time-zones.md`).
- Backups and WAL are set up before the first real data (`devops/backups-restore.md`).

### Standard — adds

- `shared_preload_libraries = 'pg_stat_statements'`; review the top 10 by total time monthly, and add indexes from evidence (`EXPLAIN (ANALYZE, BUFFERS)`), not guesses.
- `statement_timeout = '30s'` for the app role (reports and migrations use a different role with a higher limit); `lock_timeout = '5s'` for the app role.
- Autovacuum stays on. Check monthly: tables with `n_dead_tup` above 20% of `n_live_tup`, and the age of the oldest transaction (`age(datfrozenxid)` below 1 billion). Lower `autovacuum_vacuum_scale_factor` to `0.02` on big hot tables with `ALTER TABLE … SET`.
- Long transactions and forgotten `idle in transaction` sessions are the usual cause of bloat; kill them with the timeout above.
- Add pgbouncer (transaction mode, `default_pool_size = 20`) only when `max_connections` is hit or several instances connect. In transaction mode, prepared statements and session-level `SET`, advisory session locks, and `LISTEN` do not work: disable the driver's prepared statements (postgres.js `prepare: false`) and take advisory locks as `pg_advisory_xact_lock`.
- Upgrades: rehearse on a restored copy of the latest backup (`pg_upgrade --check`, then real run), timing it; do it in a planned window with a fresh backup and snapshot taken first. Minor updates come through `unattended-upgrades` and need a Postgres restart you schedule.
- Extensions list recorded (`pg_trgm`, `unaccent`, `pgcrypto`) so a restore or upgrade host installs the same.

### Advanced — adds

- Streaming replica for reads and fast failover; replication slots monitored so they do not fill `pg_wal`.
- Partition huge append-only tables (events, logs) by month and drop old partitions instead of `DELETE`.
- `pg_repack` for bloated tables online; connection pooling in front of the replica too.

## Edge cases

| Case | Expected behaviour |
|---|---|
| `FATAL: too many clients already` during a deploy | Two app instances overlapped, doubling the pool; the budget counts both, or the new instance starts after the old drains |
| `idle in transaction` holds a lock and blocks a migration | `idle_in_transaction_session_timeout` kills it; migration has `lock_timeout` and retries |
| Data at 100×: a 50 GB table | Autovacuum scale factor per table, indexes `CONCURRENTLY`, no full-table `ALTER` with rewrite; check `pg_stat_statements` for the top query first |
| Twice / parallel: two migrations at once | An advisory lock in the migration runner; the second waits or exits |
| Slow query appears only at month end | `log_min_duration_statement` and `auto_explain` (min duration 1 s) capture the plan at the time, not later |
| Disk fills because of WAL | Archiving failing or an abandoned replication slot; alert on `pg_wal` size (`devops/monitoring-logs.md`) |
| App sets `SET TIME ZONE 'Africa/Cairo'` through pgbouncer | The setting leaks to the next client in transaction mode; set zone per query or in `AT TIME ZONE` |
| Major upgrade finds an extension without a build for the new version | Rehearsal catches it; stay on the old version until the extension supports the new one |
| Integer ids near 2 billion | Monitor max id on big tables; convert to `bigint` before, not after |

## Example — Standard, 4 GB VPS

```
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = 1GB
effective_cache_size = 2GB
work_mem = 16MB
maintenance_work_mem = 256MB
random_page_cost = 1.1
effective_io_concurrency = 200
wal_compression = on
log_min_duration_statement = 500
log_lock_waits = on
idle_in_transaction_session_timeout = '60s'
shared_preload_libraries = 'pg_stat_statements'
timezone = 'UTC'
```

```sql
ALTER ROLE app SET statement_timeout = '30s';
ALTER ROLE app SET lock_timeout = '5s';

SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS DeadPct,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;

SELECT query, calls, round(total_exec_time) AS TotalMs, round(mean_exec_time::numeric, 1) AS MeanMs
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

SELECT count(*) AS Connections, state FROM pg_stat_activity GROUP BY state;
```

```ts
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

const Client = postgres(process.env.DATABASE_URL!, { max: 15, idle_timeout: 20, prepare: false })
export const db = drizzle(Client)
```

Other stacks: the same pool size rule applies to Prisma (`connection_limit` in the URL) and Laravel (PHP-FPM children × connections). Managed Postgres: set the same app-side limits; the provider's pooler replaces pgbouncer.

## Verify

- [ ] `[M]` `ss -ltn | grep 5432` shows `127.0.0.1` only; the app pool size times instances is under `max_connections`.
- [ ] `[M]` `SELECT pg_sleep(1)` appears in the log when `log_min_duration_statement` is set to 500 and the query lasts 1 s.
- [ ] `[S]` `pg_stat_statements` returns rows; a deliberately idle-in-transaction session is killed after 60 s.
- [ ] `[S]` The dead-tuple query above shows no hot table over 20%.
- [ ] `[S]` `pg_upgrade --check` passes on the restored copy and the rehearsal time is recorded.
- [ ] `[A]` Through pgbouncer the app works with `prepare: false` and a concurrency test passes.

## Pitfalls

- **`max_connections = 1000` to fix "too many clients"** → memory per connection and thrashing → fix the pool, then pgbouncer.
- **`work_mem` at 256 MB** → out of memory with 50 connections sorting → 16 MB and raise per query only.
- **Disabling autovacuum "for speed"** → bloat and transaction wraparound → tune it, never turn it off.
- **Opening 5432 for a GUI client** → brute force within hours → SSH tunnel.
- **Upgrading in place without a rehearsal or backup** → no way back → rehearse on a restore.

## Related

`devops/backups-restore.md` · `devops/monitoring-logs.md` · `devops/deploy-zero-downtime.md` · `backend/data/migrations.md` · `Stacks/Database.md`
