# Alerting

- **Situation:** "tell me when it breaks", too many alerts nobody reads, SLOs, on-call, a client asking about uptime commitments.
- **Skip when:** a prototype with no users.
- **Decision:** alert on symptoms users feel (site down, error rate, slowness), not on causes; every alert names an action and reaches one human channel; anything with no action is a dashboard, not an alert.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Not required |
| Standard | Production with real users: a few symptom alerts |
| Advanced | SLA with a client, several services: SLOs and burn-rate alerts |

## Rules

### Minimum

- Nothing to add.

### Standard — adds

- Four alerts cover most projects:
  1. Public URL down for 2 consecutive minutes (external uptime monitor).
  2. New error issue or error spike in the tracker.
  3. Disk > 80% on any server.
  4. Backup job missing for 26 hours (the job pings a heartbeat monitor on success; silence alerts).
- One channel the owner actually watches (Telegram bot, WhatsApp via provider, email as last resort); phone push for alert 1.
- Each alert text says what is wrong, where, and links the runbook line or dashboard.
- Scheduled jobs (cron) report success to a heartbeat monitor (Healthchecks.io, Better Stack, Uptime Kuma push); missing heartbeat = alert.

### Advanced — adds

- SLOs per user journey (e.g. 99.5% of checkout requests succeed under 1 s over 30 days) with multi-window burn-rate alerts (fast: 2% budget in 1 h; slow: 5% in 6 h).
- Severity levels: page (wake someone) only for SLO burn and full outages; everything else is a ticket.
- Every page gets a short post-incident note: cause, fix, alert that should have fired earlier.
- Alert review monthly: delete alerts that fired without action.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Flapping (down/up every minute) | Alert after 2 consecutive failures; recovery message sent once |
| Planned maintenance | Monitor paused for the window, resumed by the deploy script |
| Alert channel itself down (bot token expired) | A weekly test alert proves the path |
| Client wants their own status page | Public status page from the uptime tool, fed by the same checks |
| Many alerts from one root cause (DB down) | Grouped: the uptime alert pages, dependent alerts are suppressed or batched |
| 100×: Ten services instead of one | Alerts grouped by user journey and root cause; monthly review deletes alerts nobody acted on |
| Twice / parallel: Two people act on the same alert | Acknowledge in the channel before acting; the runbook names who owns which alert |

## Example — Standard

```bash
0 3 * * * /opt/app/scripts/backup.sh && curl -fsS -m 10 --retry 3 https://hc-ping.com/$BACKUP_CHECK_UUID > /dev/null
```

```md
| Alert | Source | Channel | Action |
|---|---|---|---|
| Site down 2 min | UptimeRobot / Uptime Kuma | Phone push + Telegram | Runbook §Outage |
| New / spiking error | Sentry / GlitchTip | Telegram | Open issue, check last deploy |
| Disk > 80% | Netdata / node_exporter | Telegram | Runbook §Disk |
| Backup heartbeat missing 26 h | Healthchecks.io | Telegram + email | Runbook §Backups |
```

The table goes in the project's runbook (`practices/documentation.md`), so whoever is on duty knows what each alert means.

## Verify

- [ ] `[S]` Each of the four alerts was triggered once on purpose and reached the owner.
- [ ] `[S]` Every alert names its action or runbook section.
- [ ] `[S]` Every cron job has a heartbeat.
- [ ] `[A]` SLOs written down and burn-rate alerts tested with a synthetic error burst.

## Pitfalls

- **Alerting on CPU > 80%** → noise with no user impact → alert on symptoms, graph the causes.
- **Alerts to a channel nobody watches** → outages found by the client → one watched channel.
- **Backups without a heartbeat** → silent failure for months → alert on missing success.

## Related

`quality/observability/health-checks.md` · `quality/observability/metrics.md` · `devops/INDEX.md`
