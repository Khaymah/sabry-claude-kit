# Zero-downtime deploy on one VPS

- **Situation:** "deploy without users seeing errors", restart drops requests, "roll back the last deploy", a migration must run during a release, a release script for a Bun app on systemd.
- **Skip when:** an internal tool where 10 seconds of downtime at night is acceptable; or a platform (PaaS, Kubernetes) already does rolling releases.
- **Decision:** blue/green on one VPS: every release is its own directory, two instances of one systemd template unit on ports 3000 and 3001, Nginx points at the live one; the new release starts on the idle port, passes its health check, then Nginx is reloaded to switch. Rollback is the same switch back to the previous directory.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Release directories, health check, previous release kept, `systemctl restart` in a quiet moment |
| Standard | Production with users all day: blue/green ports, switch after health check, automatic rollback on failure |
| Advanced | Long-lived connections or SLA: drain websockets, socket handoff, canary percentage |

## Rules

### Minimum — always, never cut

- Each release is `/srv/app/releases/<UTC timestamp or git sha>` with its built output and installed dependencies; `/srv/app/slots/3000` and `/srv/app/slots/3001` are symlinks, one per port, each pointing at the release that instance runs. Never build or `git pull` in place.
- Keep the last 5 releases; delete older ones only after the new release is healthy.
- Shared state lives outside releases: `.env` in `/etc/app/app.env` (mode `600`, read by systemd `EnvironmentFile`), uploads in `/srv/app/shared/uploads`, never inside a release directory.
- The service exposes `GET /health` that checks the process and a `SELECT 1` (`quality/observability/health-checks.md`). A deploy that cannot pass it does not switch.
- Repoint a slot atomically: `ln -sfn <dir> <slot>.tmp && mv -Tf <slot>.tmp <slot>`. A plain `ln -sfn` on the live name is not atomic.
- Migrations run before the switch, from the new release, with a lock so two deploys cannot run them together; the old release must keep working on the migrated schema (below).
- Bun handles `SIGTERM`: stop accepting, finish in-flight requests, close the pool, exit; systemd `TimeoutStopSec=30`.

### Standard — adds

- One template unit `app@.service` (`%i` is the port); only one of `app@3000` and `app@3001` is live. The idle one is started with the new release path, health-checked on `127.0.0.1:<port>/health`, then Nginx's included file `/etc/nginx/conf.d/app-upstream.conf` is rewritten to the new port and `nginx -s reload` runs (reload keeps old workers until their requests finish).
- Stop the old instance only after the new one has served traffic for 10 seconds with no `5xx`; keep it stopped, not removed, so rollback is a start.
- Expand/contract migrations: release N adds (nullable column, new table, new index `CONCURRENTLY`); release N+1 stops using the old shape; release N+2 drops it. A migration never renames, drops, or adds `NOT NULL` without a default in the same release that needs it (`backend/data/migrations.md`).
- Rollback = start the previous slot (it still points at the previous release), point Nginx at its port. It never runs a down-migration against production data.
- The deploy script exits non-zero on any failed step and leaves the live instance untouched. The CI job fails, the old release keeps serving.
- Background jobs (`backend/reliability/background-jobs.md`) survive two versions running together: job payloads stay readable by both, and a worker finishing mid-switch holds its advisory lock until done.

### Advanced — adds

- Websockets: before stopping the old instance, send a close with a "reconnect" code and wait up to 30 s; clients reconnect with backoff to the new instance.
- Socket handoff (systemd socket activation, `Accept=no`) when ports are inconvenient: the socket stays open across restarts, requests queue instead of failing.
- Canary: Nginx `split_clients` sends 5% of traffic to the new port for 10 minutes before the full switch.

## Edge cases

| Case | Expected behaviour |
|---|---|
| New release crashes at boot | `systemctl` shows failed on the idle port, health check never passes, the script aborts, Nginx never moved |
| Health passes but the first real request fails (missing env var used lazily) | Error rate watched for 10 s after the switch; above 1% the script switches back automatically |
| Migration adds `NOT NULL` column while old release still inserts | Old release's insert fails; so the column is nullable or has a default until release N+1 has fully replaced N |
| Migration locks a big table | `SET lock_timeout = '3s'`; the deploy fails fast and retries instead of freezing all queries; index with `CONCURRENTLY` |
| Data at 100×: 100× rows in the migrated table | Backfill in batches of 5,000 outside the deploy as a job; the deploy only adds the empty column |
| Twice / parallel: two deploys at once | `flock /var/lock/app-deploy.lock` makes the second one exit with a clear message |
| Rollback after a migration already ran | Old release must work on the new schema (expand step); if it does not, the migration was not safe to ship and the fix is forward |
| Disk almost full during a deploy | Check `df` for the releases volume before building; the deploy aborts below 2 GB free |
| Time of deploy | Not between 09:00 and 17:00 Africa/Cairo on a trading day for a shop, unless the flow is blue/green and verified |

## Example — Standard, systemd + bash

```ini
[Unit]
Description=App on port %i
After=network.target postgresql.service

[Service]
User=app
WorkingDirectory=/srv/app/slots/%i
EnvironmentFile=/etc/app/app.env
Environment=PORT=%i
ExecStart=/usr/local/bin/bun run dist/server.js
Restart=on-failure
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/app/shared

[Install]
WantedBy=multi-user.target
```

```bash
set -euo pipefail
Release="$1"
Root=/srv/app
exec 9>/var/lock/app-deploy.lock
flock -n 9 || { echo "deploy already running"; exit 1; }

Live=$(cat $Root/live-port)
if [ "$Live" = "3000" ]; then Idle=3001; else Idle=3000; fi
cd "$Root/releases/$Release"
bun run db:migrate
ln -sfn "$Root/releases/$Release" "$Root/slots/$Idle.tmp"
mv -Tf "$Root/slots/$Idle.tmp" "$Root/slots/$Idle"

sudo systemctl restart "app@$Idle"
for I in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$Idle/health" >/dev/null && Healthy=1 && break
  sleep 1
done
if [ "${Healthy:-0}" != "1" ]; then
  sudo systemctl stop "app@$Idle"
  exit 1
fi

echo "server 127.0.0.1:$Idle;" | sudo tee /etc/nginx/conf.d/app-live.inc >/dev/null
sudo nginx -t && sudo nginx -s reload
echo "$Idle" > $Root/live-port
sleep 10
sudo systemctl stop "app@$Live"
ls -1dt $Root/releases/* | tail -n +6 | xargs -r rm -rf
```

The Nginx upstream block does `include /etc/nginx/conf.d/app-live.inc;`. `deploy` has passwordless sudo only for `systemctl restart|stop app@*` and `nginx` (a `sudoers.d` file), not for everything, once the server goes past Minimum.

Rollback is the same script with the previous release name. Other stacks: PM2 cluster `reload` gives similar results for Node; Docker setups use the same two-port pattern with two containers.

## Verify

- [ ] `[M]` `ls -l /srv/app/slots/` points into `releases/`; `.env` and uploads are not inside any release.
- [ ] `[M]` `kill -TERM` during a 5-second request lets it finish before exit.
- [ ] `[S]` `while true; do curl -fsS -o /dev/null https://example.com/health || echo FAIL; sleep 0.2; done` during a deploy prints no `FAIL`.
- [ ] `[S]` A deliberately broken release (syntax error) leaves the live port serving and CI red.
- [ ] `[S]` Rollback to the previous release completes in under 30 seconds.
- [ ] `[A]` Websocket clients reconnect within 5 seconds of a deploy.

## Pitfalls

- **`systemctl restart` on the only instance** → 2–5 s of refused connections → blue/green.
- **Migrating in the app's startup code** → two instances race the migration → a separate migrate step under a lock.
- **Uploads inside the release directory** → files vanish on the next deploy → `/srv/app/shared`.
- **Down-migrations as a rollback plan** → data loss on columns already written → forward-only, expand/contract.
- **Health check that returns 200 without touching Postgres** → switch to a release that cannot read data → `SELECT 1` in `/health`.

## Related

`devops/ci-cd.md` · `devops/nginx-tls.md` · `backend/data/migrations.md` · `quality/observability/health-checks.md` · `practices/INDEX.md`
