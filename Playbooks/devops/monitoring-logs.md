# Server monitoring and logs

- **Situation:** "how do I know the site is down", disk full at 3 am, logs eating the server, too many alerts, "set up monitoring" for a freelancer's few client servers.
- **Skip when:** a managed platform provides logs and alerts; app-level logging format and error tracking are in `quality/observability/`.
- **Decision:** journald with a size cap and nothing else for logs, an uptime check from outside the server, a handful of symptom alerts (down, disk, backup missing, error spike, cert expiry) to one phone channel; everything else is a dashboard you look at when you choose to.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Any production server: outside uptime check, disk alert, log cap |
| Standard | Paying client: the five alerts, error tracking, reboot and backup heartbeat checks, weekly glance |
| Advanced | SLA or several services: metrics with Prometheus/Grafana, SLO burn alerts, on-call rota |

## Rules

### Minimum — always, never cut

- An uptime check runs from outside the server and the provider's network (UptimeRobot, Better Stack, healthchecks.io): `GET https://domain/health` every 1 minute, alert after 2 failures, checking a body string, not just status `200`.
- Cap logs: `/etc/systemd/journald.conf.d/size.conf` with `SystemMaxUse=500M`, `MaxRetentionSec=30day`, `Storage=persistent`. Nginx logs rotated by logrotate weekly, 8 kept, compressed.
- Disk alert at 80% (warning, same day) and 90% (page). Disk full stops Postgres writes, the commonest self-inflicted outage on a small VPS.
- The alert goes to one place the owner reads on a phone (Telegram, WhatsApp-capable webhook, push app), not an inbox.
- The app writes JSON to stdout; systemd captures it. No log files written by the app, no rotation to maintain (`quality/observability/logging.md`).
- Logs never contain secrets, tokens, passwords, or full card or national-ID numbers.

### Standard — adds

- Alert only on these, each with a one-line action:
  1. Site down (outside check): open the provider console, `systemctl status`.
  2. Disk above 90% or inode exhaustion: find the biggest directory, prune.
  3. Backup heartbeat missing 26 hours (`devops/backups-restore.md`): run the script by hand.
  4. Error rate: more than 5% of requests `5xx` over 5 minutes, or a new error type in error tracking (`quality/observability/error-tracking.md`).
  5. Certificate under 14 days to expiry: renewal is failing, run `certbot renew`.
- Memory: alert on swap in use above 50% for 10 minutes, or the OOM killer firing (`journalctl -k | grep -i oom`).
- Check `/var/run/reboot-required` weekly and reboot in the planned window (`devops/vps-setup.md`).
- Do not alert on CPU spikes, single slow requests, single 4xx, or restarts that recovered. Put them on a dashboard or in the weekly review.
- Each alert fires once, repeats after 4 hours if still open, and sends a "resolved" message.
- Error tracking (Sentry or GlitchTip) receives unhandled errors with release and environment tags; alerts are grouped per issue, not per event.

### Advanced — adds

- `node_exporter` and `postgres_exporter` into Prometheus, Grafana dashboards, alerts from an SLO (99.5% availability, error budget burn rate over 1 h and 6 h; `quality/observability/alerting.md`).
- A status page for the client, and a written escalation order when you are unreachable.
- Synthetic transaction (login plus one read) from outside every 5 minutes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Server is up but Postgres is down | Outside check hits `/health` that runs `SELECT 1`, so it fails and alerts; a plain `200` homepage would stay green |
| The monitor itself lives on the broken server | Alerts depend on an external service; the backup heartbeat is also external |
| Data at 100×: 100× log volume in a bug loop | journald cap drops oldest, disk stays under the cap; the same error is rate-limited in the app (`RateLimitBurst` in journald) and grouped by error tracking |
| Twice / parallel: a flapping check pages 40 times | Alert after 2 consecutive failures, repeat only every 4 hours, one message per incident |
| Egypt provider outage makes the site unreachable from one ISP | Two check locations; alert when at least two see failure |
| Alert at 3 am Cairo for a non-urgent warning | Warnings go to a silent channel until morning; only down and disk 90% wake the owner |
| Cert expired because renewal silently failed | The 14-day alert catches it with time to fix |
| Deploy restarts the app for 2 seconds | No alert: two consecutive failures at 1-minute interval are needed |
| Client's own admin sees logs | They get error tracking access, not shell access to the server |

## Example — Standard, config and bash

```ini
[Journal]
Storage=persistent
SystemMaxUse=500M
SystemKeepFree=1G
MaxRetentionSec=30day
RateLimitIntervalSec=30s
RateLimitBurst=2000
```

```
/var/log/nginx/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        [ -f /run/nginx.pid ] && kill -USR1 $(cat /run/nginx.pid)
    endscript
}
```

```bash
set -euo pipefail
Notify() { curl -fsS -m 10 --data-urlencode "text=$1" "https://api.telegram.org/bot$(cat /etc/app/tg.token)/sendMessage?chat_id=$(cat /etc/app/tg.chat)" >/dev/null; }

Used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$Used" -lt 90 ] || Notify "$(hostname): disk at ${Used}%"

Inodes=$(df --output=ipcent / | tail -1 | tr -dc '0-9')
[ "$Inodes" -lt 90 ] || Notify "$(hostname): inodes at ${Inodes}%"

systemctl is-active --quiet postgresql || Notify "$(hostname): postgresql is not active"
[ ! -f /var/run/reboot-required ] || [ "$(date +%u)" != "1" ] || Notify "$(hostname): reboot needed"
curl -fsS -m 10 "$(cat /etc/app/heartbeat-monitor.url)" >/dev/null
```

Run with a systemd timer every 5 minutes. The final heartbeat means the external service alerts when the monitor script itself stops running. Other stacks: Netdata or Uptime Kuma (self-hosted) work, but host Kuma on a different server than the app.

## Verify

- [ ] `[M]` Stop the app: the phone alert arrives within 3 minutes; start it: "resolved" arrives.
- [ ] `[M]` `journalctl --disk-usage` is under the cap; `du -sh /var/log` is small.
- [ ] `[S]` `dd` a 3 GB file on a staging box: the 90% alert fires; delete the file.
- [ ] `[S]` Throw a test error in the app: it appears in error tracking with release and environment.
- [ ] `[S]` Count alerts last month; any that needed no action is deleted or downgraded.
- [ ] `[A]` The SLO dashboard shows availability for the last 30 days.

## Pitfalls

- **Alerting on every metric** → alert fatigue, the real one ignored → five symptom alerts.
- **Uptime check against `/` served by Nginx cache** → green while the app is dead → hit `/health` through the proxy.
- **Unbounded journal and Nginx logs** → disk fills, Postgres stops → size caps and logrotate.
- **Monitoring on the same server it watches** → silent when the server dies → external check plus heartbeat.
- **Logging request bodies** → passwords and tokens in logs → log ids and metadata only.

## Related

`quality/observability/logging.md` · `quality/observability/error-tracking.md` · `quality/observability/alerting.md` · `quality/observability/health-checks.md` · `devops/backups-restore.md` · `devops/vps-setup.md`
