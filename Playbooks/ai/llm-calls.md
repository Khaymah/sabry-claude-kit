# Calling an LLM from the backend

- **Situation:** "call Claude", "summarise this", "extract fields from text", "stream the answer", "return JSON from the model", any server code that sends a prompt to a model.
- **Skip when:** a managed product already does the whole job (a hosted chat widget with no custom logic).
- **Decision:** one `LlmClient` adapter owns the provider SDK, timeouts, retries, logging and usage metering; features call the adapter, never `@anthropic-ai/sdk` directly. Anything longer than a few seconds runs as a background job, not in the request.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | Any LLM call in production: adapter, timeout, validation of output, no personal data in logs |
| Standard | User-facing features: retries with backoff, streaming, repair-once, usage metering |
| Advanced | Several providers or high volume: fallback model, circuit breaker, queueing with concurrency caps |

## Rules

### Minimum — always, never cut

- Only the adapter imports the provider SDK. Model ids come from config (env), never literals in feature code.
- Every call has a timeout (default 30 s non-streaming, 60 s to first token when streaming) and a `max_tokens`.
- Model output is untrusted input: parse and validate with Zod before use; never `JSON.parse` straight into the database.
- Logs carry feature name, model, token counts, latency and request id; never the prompt or the answer text, never names, phones, emails or national ids. Raw prompts are stored only when the owner opts in, per tenant, with a retention limit.
- The API key lives in env/secret store, is never sent to the client, and the call happens on the server only.
- Tenant id is passed into the adapter and recorded with usage; the adapter refuses a call without it.

### Standard — adds

- Retry only `429`, `529`, `500`-class and network errors; at most 3 attempts, exponential backoff with full jitter, honour `retry-after`. Never retry `400`/`401`/`403`/`404`.
- Streaming: server-sent events from the route; forward chunks as they arrive, send a final `done` event with usage, stop the upstream call when the client disconnects (`AbortSignal`).
- Structured output: ask for JSON through a tool/schema definition, validate with Zod. On failure, one repair call that sends the validation error and the bad output; still failing → typed `LLM_INVALID_OUTPUT`, no third try.
- Work that can exceed ~10 s (long documents, batches, reports) is enqueued (`backend/reliability/background-jobs.md`); the request returns a job id and the client polls or listens.
- Record usage per call in a table (`cost-limits.md`).
- Same input twice from the client uses an idempotency key so a double click does not pay twice (`backend/reliability/idempotency.md`).

### Advanced — adds

- Fallback to a second model after retries are exhausted, marked in the log; circuit breaker opens after repeated provider failures and returns a clear "temporarily unavailable".
- Global and per-tenant concurrency cap on in-flight calls; excess waits in the queue.
- Pin model versions per feature and change them through an eval run (`evals.md`).

## Edge cases

| Case | Expected behaviour |
|---|---|
| Provider returns `529` (overloaded) | Backoff and retry up to 3; then `503` with `retry-after`; the job is rescheduled, not lost |
| Stream breaks midway | Client gets an `error` event; the partial text is not saved as a final answer |
| Output cut at `max_tokens` (`stop_reason` = `max_tokens`) | Treated as failure for structured output, not parsed; for chat, flagged as truncated |
| Model wraps JSON in prose or code fences | Zod fails, repair call runs once; the adapter never uses regex scraping as the main path |
| Model returns valid JSON with an empty or wrong-language field | Zod refinements reject it (min length, enum) and count as invalid output |
| Data at 100×: input document 100× larger | Count tokens before the call; over the limit → chunk and map-reduce in a job, or reject with `413`; never silently truncate |
| Twice / parallel: user submits the same request twice | Idempotency key returns the first job; one model call, one usage row |
| Client disconnects during a long stream | Upstream aborted; tokens already used are still metered |
| Retry succeeds after a timeout that actually completed upstream | Possible double charge; accepted for reads, but side effects never run inside the call (`prompt-injection.md`) |
| Provider returns empty content | Treated as invalid output, one retry, then typed error |
| Arabic text | Token counts are higher than English; budgets and `max_tokens` use measured tokens, not character counts |

## Example — Standard, Bun + Hono + Drizzle

```ts
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

export type TLlmRequest = { TenantId: string; Feature: string; System: string; User: string; MaxTokens: number }

export class LlmClient {
  private Sdk = new Anthropic({ apiKey: Env.AnthropicApiKey, maxRetries: 0, timeout: 30_000 })

  async Complete(Req: TLlmRequest, Model = Env.LlmModelDefault) {
    for (let Attempt = 0; ; Attempt++) {
      const Started = Date.now()
      let Res: Anthropic.Message
      try {
        Res = await this.Sdk.messages.create({
          model: Model,
          max_tokens: Req.MaxTokens,
          system: Req.System,
          messages: [{ role: "user", content: Req.User }],
        })
      } catch (E) {
        if (!(E instanceof Anthropic.APIError)) throw E
        const Status = E.status
        const Retryable = Status === undefined || Status === 429 || Status === 529 || Status >= 500
        if (!Retryable || Attempt >= 2) throw new AppError("LLM_UNAVAILABLE", 503)
        await Bun.sleep(Math.random() * 500 * 2 ** Attempt)
        continue
      }
      await RecordUsage(Req.TenantId, Req.Feature, Model, Res.usage, Date.now() - Started)
      return Res
    }
  }

  async CompleteJson<T extends z.ZodTypeAny>(Req: TLlmRequest, Schema: T): Promise<z.infer<T>> {
    const First = await this.Complete(Req)
    const Text = First.content.map((B) => (B.type === "text" ? B.text : "")).join("")
    const Parsed = Schema.safeParse(SafeJson(Text))
    if (Parsed.success) return Parsed.data
    const Retry = await this.Complete({ ...Req, User: `${Req.User}\n\nPrevious output was invalid: ${Parsed.error.message}\nReturn only corrected JSON.\n${Text}` })
    const Again = Schema.safeParse(SafeJson(Retry.content.map((B) => (B.type === "text" ? B.text : "")).join("")))
    if (!Again.success) throw new AppError("LLM_INVALID_OUTPUT", 502)
    return Again.data
  }
}
```

Use the SDK's tool/JSON mode where available for the first attempt. Model ids come from `Env` (latest: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`); check current pricing before budgeting.

Other stacks: the same shape with the provider SDK's retry option disabled so there is one retry layer.

## Verify

- [ ] `[M]` `grep` for `@anthropic-ai/sdk` finds only the adapter file.
- [ ] `[M]` Log lines for a call contain no prompt text or personal data.
- [ ] `[M]` Invalid model output never reaches the database (test with a mocked bad reply).
- [ ] `[S]` Mocked `529` twice then success → 3 calls, one usage row.
- [ ] `[S]` Aborting the client request aborts the upstream call.
- [ ] `[A]` With the primary model failing, the fallback answers and the log marks it.

## Pitfalls

- **SDK retries plus your own retries** → 9 attempts, retry storms → disable one layer.
- **Retrying a 400** → same failure, wasted money → retry only transient codes.
- **Waiting on the model inside the request for long jobs** → gateway timeouts → job plus polling.
- **Logging the prompt "for debugging"** → personal data in logs → log metadata only.
- **Trusting `JSON.parse` of model text** → crash or bad data → Zod at the boundary.

## Related

`backend/reliability/outbound-calls.md` · `backend/reliability/background-jobs.md` · `backend/reliability/idempotency.md` · `quality/reliability/timeouts-retries.md` · `ai/cost-limits.md` · `ai/prompt-injection.md`
