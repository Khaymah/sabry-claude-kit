# AI cost and usage limits

- **Situation:** "the AI bill exploded", per-customer quotas, "limit free users", token budgets, "which model should this use", caching prompts, someone pasting a huge document.
- **Skip when:** the feature is internal, used by a handful of staff, and the provider's own spend cap is enough.
- **Decision:** every model call is metered per tenant and user in our own table, checked against a budget before the call and settled after it. Cheap model first, prompt caching on stable prefixes, hard caps on input and output size.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | Any public or multi-user AI feature: input cap, `max_tokens`, usage rows, provider spend cap |
| Standard | Paying tenants: budgets per tenant and user, model routing, prompt caching, alerts |
| Advanced | AI is a priced product: plan-based quotas, overage billing, reservations, per-feature margin reports |

## Rules

### Minimum — always, never cut

- Every call sets `max_tokens`, and user input has a hard limit in tokens (measured, not characters); over it → `413`, never silent truncation.
- Every call writes a usage row: tenant, user, feature, model, input tokens, output tokens, cached tokens, latency, status. Written by the adapter (`llm-calls.md`), never by feature code.
- A spend cap is set at the provider account level as the last line of defence.
- Do not hardcode prices in code or docs: check current pricing and keep rates in a table or config with an effective date.
- The AI endpoints are rate limited per user and per tenant (`backend/reliability/rate-limit.md`) before any model call.

### Standard — adds

- Budget per tenant per month and per user per day, in tokens (or cost units from the rate table). The check runs before the call; the exact usage is added after.
- Budget check and increment are one atomic conditional `UPDATE … WHERE Used + $estimate <= Limit RETURNING` (`backend/data/concurrency.md`); no row → `429 AI_BUDGET_EXCEEDED` with the reset time.
- Model routing: the small model first for classification, routing, extraction and short answers; escalate to the larger model only on low confidence, failed validation, or an explicit feature need. Record which model answered.
- Prompt caching: put the long stable part (system prompt, tool definitions, reference text) first and mark it cacheable; per-request text last. Verify through the cached-token counts in usage, not by assumption.
- Conversation history is trimmed or summarised past a token budget; never resend an unbounded transcript.
- Alerts: tenant at 80% and 100% of budget, daily spend over a multiple of the 7-day average, error and retry spikes, one user over 10× the median (`quality/observability/alerting.md`).

### Advanced — adds

- Reserve the estimated tokens before the call, release the difference after; stale reservations expire.
- Plan-based quotas and overage lines on the invoice (`backend/data/money.md`), usage exported per tenant.
- Cache identical deterministic requests (feature, normalised input hash, model) with a TTL, per tenant only.
- Weekly report of cost per feature against revenue; a feature with negative margin is flagged.

## Edge cases

| Case | Expected behaviour |
|---|---|
| User pastes a 500-page PDF | Token count measured first; over the cap → `413` with the limit; or chunked job if the feature supports it |
| Budget has 100 tokens left, call needs more | Estimate reserved atomically; if it does not fit, `429` before calling; the overshoot after a call is bounded by `max_tokens` |
| Two parallel requests race the last budget | Atomic conditional update: one passes, one gets `429` |
| Retries after `529` | Failed attempts that returned no usage are not charged; successful ones are metered once per call id |
| Provider changes its rates | Old usage rows keep the rate in force when written; a new rate row has an effective date |
| Month boundary | Budget periods use Africa/Cairo month start (`backend/data/time-zones.md`), stored as a period key; a call at 23:59:59 counts in the old month |
| Data at 100×: usage table at 500M rows | Partition by month, aggregate nightly into a summary table; the budget check reads the counter row, never sums the log |
| Twice / parallel: client resends after a timeout | Idempotency key: one model call, one usage row, budget charged once |
| Streaming aborted by the client | Tokens used so far are metered from the final usage or an estimate |
| Free tenant loops the API in a script | Per-user and per-tenant rate limit trips first; budget caps the rest; alert fires |
| Cached tokens | Metered separately; budget uses the weighted units from the rate table |
| Arabic input | More tokens than the same English text; budgets and limits are in tokens |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function ReserveBudget(TenantId: string, Period: string, Estimate: number) {
  const Rows = await db.execute<{ Used: number }>(sql`
    UPDATE "AiBudgets" SET "Used" = "Used" + ${Estimate}
    WHERE "TenantId" = ${TenantId} AND "Period" = ${Period} AND "Used" + ${Estimate} <= "Limit"
    RETURNING "Used"`)
  if (!Rows.length) throw new AppError("AI_BUDGET_EXCEEDED", 429)
}

export async function SettleBudget(TenantId: string, Period: string, Estimate: number, Actual: number) {
  await db.execute(sql`UPDATE "AiBudgets" SET "Used" = "Used" + ${Actual - Estimate} WHERE "TenantId" = ${TenantId} AND "Period" = ${Period}`)
}

export const AiUsage = pgTable("AiUsage", {
  Id: uuid("Id").primaryKey().defaultRandom(),
  TenantId: uuid("TenantId").notNull(),
  UserId: uuid("UserId").notNull(),
  Feature: text("Feature").notNull(),
  Model: text("Model").notNull(),
  InputTokens: integer("InputTokens").notNull(),
  OutputTokens: integer("OutputTokens").notNull(),
  CachedTokens: integer("CachedTokens").notNull().default(0),
  LatencyMs: integer("LatencyMs").notNull(),
  Status: text("Status").notNull(),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull().defaultNow(),
})
```

Routing: `const Model = Confidence < 0.7 ? Env.LlmModelLarge : Env.LlmModelSmall`, ids from config (latest: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`). Add an index on `(TenantId, CreatedAt)`.

Other stacks: the same single conditional statement; Redis counters only with a Lua script, and the table stays the record.

## Verify

- [ ] `[M]` An input over the token cap is rejected before any provider call.
- [ ] `[M]` Every call path writes exactly one usage row (mock the provider and count).
- [ ] `[S]` 20 parallel calls with budget for 5 → 5 pass, 15 get `429`.
- [ ] `[S]` Usage shows non-zero cached tokens on the second call with the same prefix.
- [ ] `[A]` Overage appears on the invoice and matches the sum of usage rows.

## Pitfalls

- **Checking the budget by summing the usage log** → slow and racy → counter row, atomic update.
- **Cost estimated from characters** → Arabic under-counted → token counts.
- **Per-request text before the stable prefix** → cache never hits → stable first.
- **Always using the largest model** → cost with no gain → route and measure with evals.
- **Prices copied into code** → silently wrong → rate table with effective dates.

## Related

`backend/reliability/rate-limit.md` · `backend/data/concurrency.md` · `backend/data/money.md` · `backend/data/time-zones.md` · `quality/observability/alerting.md` · `ai/llm-calls.md` · `ai/evals.md`
