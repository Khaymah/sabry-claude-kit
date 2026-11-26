# Request correlation

- **Situation:** following one request through logs, jobs and outbound calls; a user reports "it failed at 3:15" and you need every line about it; support asks for a reference number.
- **Skip when:** a CLI script or a one-shot job (use a run id instead).
- **Decision:** a request id is accepted or generated at the edge, stored in async context, attached to every log line, returned in the `X-Request-Id` response header, and forwarded to jobs and outbound calls.

## Levels

| Level | Pick when |
|---|---|
| Minimum | The id in the response header and the error log |
| Standard | Any production server |
| Advanced | Several services or queues: use trace context (`quality/observability/tracing.md`) |

## Rules

### Minimum — always, never cut

- Nginx sets `X-Request-Id` from `$request_id` when absent; the app accepts it only if it matches `^[A-Za-z0-9-]{8,64}$`, otherwise generates one.
- The response carries `X-Request-Id`; error responses include it in the body (`Error.RequestId`) so users and support can quote it.

### Standard — adds

- The id lives in async context (`AsyncLocalStorage` or Hono's `c.set`) with a child logger, so code never passes it by hand.
- Jobs enqueued during a request store `RequestId` in their payload; the job's logger uses it as `ParentRequestId` plus its own `JobId`.
- Outbound HTTP calls send `X-Request-Id` to providers that accept it, and log the provider's own reference (`ProviderRef`) next to it.
- Error tracker events are tagged with the same id.

### Advanced — adds

- W3C `traceparent` replaces the custom header between our services; the request id stays for humans and support.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Client sends a 5 KB or malicious `X-Request-Id` | Ignored and replaced; never logged raw |
| Code runs outside a request (cron, startup) | A generated `RunId` in the same field, so queries work the same way |
| Event listener runs after the response was sent | Still inside the same async context; carries the request id |
| Webhook from a provider | Its delivery or event id is logged as `ProviderEventId`, alongside our request id |
| Retry of a failed job | Same `ParentRequestId`, new attempt number |

## Example — Standard, Bun + Hono

```ts
const VALID_ID = /^[A-Za-z0-9-]{8,64}$/

App.use("*", async (c, Next) => {
  const Incoming = c.req.header("X-Request-Id") ?? ""
  const RequestId = VALID_ID.test(Incoming) ? Incoming : crypto.randomUUID()
  c.set("RequestId", RequestId)
  c.set("Log", Logger.child({ RequestId }))
  c.header("X-Request-Id", RequestId)
  await RequestContext.run({ RequestId }, Next)
})

export async function Enqueue(Name: string, Payload: object) {
  const ParentRequestId = RequestContext.getStore()?.RequestId
  await Jobs.Insert({ Name, Payload: { ...Payload, ParentRequestId } })
}
```

```nginx
proxy_set_header X-Request-Id $request_id;
```

`RequestContext` is an `AsyncLocalStorage<{ RequestId: string }>` in `Core/Context.ts`. Nginx only forwards `$request_id`; the app sets the response header, so Nginx error pages (502) carry no id, and the access log of Nginx (`$request_id` in its `log_format`) bridges that gap.

## Verify

- [ ] `[M]` Every response has `X-Request-Id`; a 500 body contains the same id.
- [ ] `[M]` A 200-character incoming id is replaced.
- [ ] `[S]` `grep <id>` on the logs returns the request line, the service lines and the job lines it caused.
- [ ] `[S]` The error tracker event for a forced error shows the same id.

## Pitfalls

- **Passing the id through every function signature** → noise and gaps → async context.
- **Trusting any incoming header** → log injection, huge values → validate and cap.
- **New id in the job** with no link to the request → the trail breaks at the queue → store the parent id.

## Related

`quality/observability/logging.md` · `quality/observability/tracing.md` · `backend/reliability/background-jobs.md`
