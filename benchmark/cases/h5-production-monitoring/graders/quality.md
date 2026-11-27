---
type: llm
---
PASS if the plan includes an external uptime check that alerts a human channel, error tracking (Sentry or a self-hosted equivalent) tagged with release, separate liveness/readiness endpoints, structured logs with a request id and rotation, a heartbeat for the backup job (alert on missing success) plus a restore test, disk/memory alerts on the VPS, and graceful reloads; and it stays proportionate to one VPS (no Kubernetes or a large self-hosted stack as a requirement).
FAIL if the missed-backup problem is not addressed by an alert on missing success, or if there is no external uptime monitoring.
