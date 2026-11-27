# DevOps playbooks

Pick 1–3 files whose situation matches the task. File paths in this table are relative to this folder; paths inside playbooks are relative to `Playbooks/`. `planned` = not written yet: work without it and say so.

Owner default hosting: one VPS with Nginx, Bun under systemd, PostgreSQL on the same VPS or managed. No Docker unless the client asks.

| Situation | File | Status |
|---|---|---|
| New VPS, harden the server, SSH keys, firewall, deploy user | `vps-setup.md` | ✅ |
| Nginx in front of Bun, HTTPS certificate, uploads blocked, wrong client IP, websockets | `nginx-tls.md` | ✅ |
| Deploy without downtime, rollback, migration during a deploy | `deploy-zero-downtime.md` | ✅ |
| GitHub Actions, auto deploy, secrets, approval before production | `ci-cd.md` | ✅ |
| Backups, restore test, point-in-time recovery, uploaded files backup | `backups-restore.md` | ✅ |
| Server logs, disk full, uptime alerts, what to be alerted on | `monitoring-logs.md` | ✅ |
| Too many connections, slow queries, vacuum, Postgres config on a small VPS, major upgrade | `postgres-ops.md` | ✅ |
