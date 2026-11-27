# Error handling

- **Situation:** try/catch, error classes, the error middleware, error responses, unhandled rejections, provider errors, "the server crashed", errors that leak stack traces.
- **Skip when:** never for server code.
- **Decision:** two kinds of errors. **Expected** ones (validation, not found, forbidden, declined) are `AppError`s with a stable code and status, thrown where detected and turned into the shared response shape by one error middleware. **Unexpected** ones (bugs, broken dependencies) reach the same middleware as 500 with a request id, are logged once and tracked; at process level they end the process so it restarts clean.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every server |
| Standard | Production: provider error mapping, client-safe messages, tracking |
| Advanced | Several services: error contracts and partial-failure handling |

## Rules

### Minimum — always, never cut

- One `AppError` class (or a small family; the project's existing one if it has it) with `Code` (stable, `UPPER_SNAKE` by default), `Status` and optional `Details`; thrown with `throw new AppError("ORDER_NOT_FOUND", 404)`.
- One error middleware maps `AppError` to the response shape and everything else to `500 INTERNAL_ERROR` with `RequestId`; no stack, SQL or provider message ever reaches the client.
- `catch` only where you can do something: recover, add context and rethrow, or translate. No empty catch, no log-and-continue for errors that leave data half-written.
- Validation errors come from the schema at the route (`zValidator`), returned as `400` (or the project's validation status) with field-level `Details`.
- `process.on("unhandledRejection")` and `uncaughtException`: log as fatal, report, exit non-zero; PM2 or systemd restarts the process.

### Standard — adds

- Provider adapters translate provider errors to our codes at the boundary (`PAYMENT_DECLINED`, `PROVIDER_UNAVAILABLE`), keeping the provider's reference in logs only.
- Database errors with meaning are translated: unique violation (`23505`) → `409 <ENTITY>_EXISTS`, foreign key (`23503`) → `409` or `400`, serialization failure (`40001`) → retried by the transaction helper.
- Error messages for users are i18n keys (`Message: "orders.not_found"`), translated by the response helper; `Code` stays English and stable for clients.
- 5xx and unknown errors go to the error tracker (`quality/observability/error-tracking.md`); 4xx don't.
- Background jobs: an error marks the attempt failed with the error code; retries follow the job's policy; the last failure is visible to an operator.

### Advanced — adds

- Error codes are documented per endpoint in the API contract; removing or renaming one is a breaking change.
- Partial failures in batch operations return per-item results (`{ Succeeded: [...], Failed: [{ Index, Code }] }`), never all-or-nothing by accident.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Error thrown after part of the data was written | The whole operation was in one transaction, so nothing is half-written |
| Error inside an event listener after the response | Logged and tracked with the request id; does not crash the process; the listener's own retry if it is a job |
| Third-party SDK throws strings or plain objects | The adapter wraps them in `AppError` or `Error` with context |
| Error while rendering the error response | The middleware falls back to a minimal static 500 body |
| User sends malformed JSON | `400 INVALID_JSON`, not a 500 |
| 100×: a dependency fails for every request | One tracker issue, the alert fires once, responses are fast 503s (`quality/reliability/timeouts-retries.md`) |
| Twice / parallel: two requests create the same unique row | The loser gets `409 <ENTITY>_EXISTS` from the translated `23505`, never a 500 |

## Example — Standard, Bun + Hono

The sample uses the owner's default codes, statuses and shape; keep the project's own.

```ts
export class AppError extends Error {
  constructor(public Code: string, public Status: ContentfulStatusCode = 400, public Details?: unknown) {
    super(Code)
  }
}

const PG_ERRORS: Record<string, (E: { constraint?: string }) => AppError> = {
  "23505": (E) => new AppError(`${ConstraintEntity(E.constraint)}_EXISTS`, 409),
  "23503": () => new AppError("REFERENCE_NOT_FOUND", 409),
}

export function ToAppError(Err: unknown): AppError | null {
  if (Err instanceof AppError) return Err
  const Code = (Err as { code?: string })?.code
  return Code && PG_ERRORS[Code] ? PG_ERRORS[Code](Err as { constraint?: string }) : null
}

App.onError((Err, c) => {
  const Known = ToAppError(Err)
  if (Known) return c.json({ Success: false, Error: { Code: Known.Code, Message: T(c, Known.Code), Details: Known.Details } }, Known.Status)
  ReportUnexpected(Err, c)
  return c.json({ Success: false, Error: { Code: "INTERNAL_ERROR", Message: T(c, "INTERNAL_ERROR"), RequestId: c.get("RequestId") } }, 500)
})

process.on("unhandledRejection", (Reason) => {
  Logger.fatal({ err: Reason }, "unhandled rejection")
  process.exit(1)
})
```

`ReportUnexpected` logs once and sends to the tracker; `T` translates the code for the request's language.

## Verify

- [ ] `[M]` A thrown `Error("boom")` returns a 500 with `RequestId` and no stack in the body.
- [ ] `[M]` Malformed JSON returns 400.
- [ ] `[M]` `grep -rnE "catch \([^)]*\) \{\s*\}" Src/` finds nothing.
- [ ] `[S]` Creating a duplicate returns 409 with an `_EXISTS` code (the project's own code and casing if it has them).
- [ ] `[S]` A provider timeout returns `PROVIDER_UNAVAILABLE` (503), not the provider's raw message.
- [ ] `[A]` Error codes per endpoint listed in the API docs.

## Pitfalls

- **`res.status(500).json({ error: err.message })`** → SQL and internals leak → codes and the shared shape.
- **Catching to log and continuing** → half-written state → transaction + rethrow.
- **Keeping the process alive after `uncaughtException`** → unknown state, corrupt memory → exit and restart.

## Related

`quality/observability/logging.md` · `quality/observability/error-tracking.md` · `quality/reliability/timeouts-retries.md` · `Stacks/Bun-Hono.md` §Responses
