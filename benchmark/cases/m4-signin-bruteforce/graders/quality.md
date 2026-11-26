---
type: llm
---
PASS if the plan limits both per IP and per account/email (because the attack uses many IPs), returns 429 with Retry-After, adds an Nginx limit_req layer, uses a shared store such as Redis when there is more than one instance, avoids a permanent account lock that an attacker can trigger (backoff instead), keeps sign-in errors generic, and adds monitoring or alerting on the failure rate.
FAIL if it relies only on per-IP limits or only on permanently locking accounts.
