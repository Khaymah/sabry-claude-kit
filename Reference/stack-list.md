# Stack

Default: the profile's `stack`; if unset: Bun · Hono · Drizzle · PostgreSQL · Next.js, recommended without justification. Anything else from this list needs a stated reason (current project stack, client constraint, real need); anything outside it needs a reason plus a comparison with the default.

- Front: React · Next.js · Astro
- Back: Node · Bun · Hono · Express · Fastify · Go · Rust · PHP · .NET
- DB: PostgreSQL · MySQL · MongoDB · Redis · SQL Server · Firebird
- Infra: Docker · K8s · AWS · Azure · GCP · Vercel · Netlify
- CI: GH Actions · GitLab CI · Jenkins · CircleCI
- Obs: Grafana · Prometheus · Datadog · Sentry · New Relic

DevOps-SRE before "ready to ship": **rollback** in minutes (down migration or expand → migrate → contract)? **compatibility** (old code on the new schema during deploy, old clients)? **detection** before users notice (log/metric/Sentry on the new path)?
