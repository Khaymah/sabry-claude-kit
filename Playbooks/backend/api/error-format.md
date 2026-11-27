# API error format

- **Situation:** designing error responses, validation errors for forms, error codes the mobile app switches on, translated messages, a client asking "what errors can this return?".
- **Skip when:** never for an API with any client.
- **Decision:** the owner's shape `{ Success: false, Error: { Code, Message, Details?, RequestId? } }` is the default for a project with no error shape yet; an existing shape is kept and `Code`, `Message` and `Details` are mapped onto it. Either way every error uses one shape. `Code` is a stable English `UPPER_SNAKE` identifier clients switch on; `Message` is translated for humans and never parsed; `Details` carries field errors for forms. Server internals never appear.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Shape, codes and field details |
| Standard | Translated messages, a code catalogue, request id on 5xx |
| Advanced | Public API: documented codes per endpoint, `Retry-After`, problem-details compatibility if clients need it |

## Rules

### Minimum — always, never cut

- One shape for every error (the project's existing one, else the default above), produced only by the error middleware (`quality/reliability/error-handling.md`).
- Codes are stable and specific (`ORDER_NOT_FOUND`, `OUT_OF_STOCK`, `AUTH_INVALID`), not HTTP names (`BAD_REQUEST`) except for generic cases.
- Validation errors: `400 VALIDATION_FAILED` (`422` if that is the project's validation status) with `Details: [{ Field: "Items.0.Quantity", Code: "too_big", Params: { Max: 50 } }]`, field paths matching the request body.
- No stack traces, SQL, file paths or provider messages in any response.

### Standard — adds

- `Message` translated from the code using `Accept-Language` (`ar`, `en`), falling back to English; the frontend may also translate from `Code` itself.
- `RequestId` on every 5xx, shown to the user as a reference number.
- A code catalogue in one module (`Core/Errors/App.Errors.ts`) with the status for each code; adding a code is a reviewed change.
- `429` and `503` carry `Retry-After`.
- Frontend maps `Details` onto form fields and shows `Message` for the rest.

### Advanced — adds

- Each endpoint's OpenAPI entry lists its possible codes.
- Codes never removed or renamed in a version; deprecated codes documented.
- `application/problem+json` (RFC 9457) offered when integrators require it, mapped from the same codes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Several invalid fields | All reported in `Details`, not only the first |
| Error in a nested array item | Field path with index (`Items.2.ProductId`) |
| Business error with data the UI needs (available stock) | In `Details` (`{ Available: 2 }`), never parsed from `Message` |
| Arabic user, unknown code in translations | English message, logged as a missing translation |
| Error from a provider (card declined) | Our code (`PAYMENT_DECLINED`) plus a safe reason code (`insufficient_funds`) if the UI needs it |
| 100×: many clients and versions | Codes stable across versions; new codes are additive |
| Twice / parallel: duplicate create | `409 <ENTITY>_EXISTS`, the same every time |

## Example — Standard

The samples use the owner's default shape; keep the project's own.

```json
{
  "Success": false,
  "Error": {
    "Code": "VALIDATION_FAILED",
    "Message": "بعض البيانات غير صحيحة",
    "Details": [
      { "Field": "Email", "Code": "invalid_string", "Params": { "Validation": "email" } },
      { "Field": "Items.0.Quantity", "Code": "too_big", "Params": { "Max": 50 } }
    ]
  }
}
```

```ts
export const ValidationHook: Hook<unknown, AppEnv, string> = (Result, c) => {
  if (Result.success) return
  const Details = Result.error.issues.map((I) => ({ Field: I.path.join("."), Code: I.code, Params: IssueParams(I) }))
  return c.json({ Success: false, Error: { Code: "VALIDATION_FAILED", Message: T(c, "VALIDATION_FAILED"), Details } }, 400)
}
```

Passed as the third argument of every `zValidator(...)` (or wrapped once in a project helper), so all validation errors share the format.

## Verify

- [ ] `[M]` Two invalid fields produce two `Details` entries with correct paths.
- [ ] `[M]` A forced 500 body contains only `Code`, `Message`, `RequestId`.
- [ ] `[S]` `Accept-Language: ar` returns Arabic messages; unknown codes fall back to English.
- [ ] `[S]` Every thrown code exists in the catalogue (a test scans `new AppError("` literals).
- [ ] `[A]` OpenAPI lists codes per endpoint.

## Pitfalls

- **Clients parsing `Message`** → breaks on translation or rewording → switch on `Code`.
- **Generic `BAD_REQUEST` everywhere** → the UI can't react specifically → specific codes.
- **Only the first validation error** → users fix one field at a time → all of them.

## Related

`quality/reliability/error-handling.md` · `backend/api/rest-design.md` · `frontend/INDEX.md`
