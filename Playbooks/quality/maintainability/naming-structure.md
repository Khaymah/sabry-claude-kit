# Naming and structure

- **Situation:** naming a function, variable, file, table or route; deciding where a new file goes; a codebase with mixed conventions.
- **Skip when:** never; but the project's existing convention always beats this file.
- **Decision:** the codebase's existing convention first. In a new project, the owner's stack conventions (`Stacks/Bun-Hono.md` §Naming, `Stacks/NextJS.md`) apply. Names say what and why in the domain's words; structure groups by feature.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every project |
| Standard | Code someone else will read or maintain |
| Advanced | A shared codebase with several contributors |

## Rules

### Minimum — always, never cut

- Before naming anything, read three neighbouring files and copy their convention (case, suffixes, folder placement). Don't introduce a second convention.
- Names use the business's words (`Invoice`, `Refund`, `Enrollment`), the same word everywhere: not `Order` in the API, `Purchase` in the service and `Cart` in the table.
- Functions are verbs (`CalculateTax`, `SendInvoice`); booleans read as questions (`IsPaid`, `HasAccess`, `CanRefund`); collections are plural.
- Units in names when ambiguous: `TimeoutMs`, `AmountMinor`, `SizeBytes`, `ExpiresAt` (a point in time) vs `TtlSeconds` (a duration).
- No `Data`, `Info`, `Manager`, `Helper`, `Utils`, `Temp`, `New`, `2` suffixes. Name what it is.

### Standard — adds

- One glossary line per domain term in `.agents/memory/` or the README when a term has a specific meaning ("Active member = paid in the last 30 days").
- File names match their main export; one main concept per file.
- API routes kebab-case nouns (`/api/v1/password-resets`), actions as sub-resources only when no noun fits (`/orders/{Id}/cancel`).

### Advanced — adds

- Lint rules enforce naming (`@typescript-eslint/naming-convention`) so reviews don't argue about it.
- Public API and event names reviewed like a contract: renaming is a versioned change.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The project mixes conventions | Follow the convention of the folder you are in; list the inconsistency once in the report, don't mass-rename |
| Owner's PascalCase vs the framework's convention (Next.js `page.tsx`, `route.ts`) | Framework-required file names win; everything inside follows the owner's convention |
| External API field names (`amount_cents`) | Keep them in the adapter's provider types; map to our names at the boundary |
| Arabic business term with no good English word | Pick one English term, record the mapping in the glossary, use it everywhere |
| Abbreviations | Only universal ones (`Id`, `Url`, `Api`, `Html`); `Qty`, `Amt`, `Usr` are spelled out |

## Example — Standard, Bun + Hono

```ts
export async function CancelEnrollment(EnrollmentId: string, CancelledBy: string, Now = new Date()) {
  const Enrollment = await GetActiveEnrollment(EnrollmentId)
  const IsWithinRefundWindow = Now.getTime() - Enrollment.StartedAt.getTime() < REFUND_WINDOW_MS
  return IsWithinRefundWindow ? RefundAndCancel(Enrollment, CancelledBy) : CancelWithoutRefund(Enrollment, CancelledBy)
}
```

Not: `async function handle(data) { const res = await getData(data.id); const flag = … }`.

## Verify

- [ ] `[M]` New files sit next to similar files and follow their case and suffixes.
- [ ] `[M]` No new identifier ends in `Data`, `Info`, `Helper`, `Manager`, `Utils`, `2`.
- [ ] `[M]` Durations and amounts carry their unit in the name.
- [ ] `[S]` The same concept has the same name in route, service, table and frontend type.
- [ ] `[A]` Naming lint rule passes in CI.

## Pitfalls

- **Renaming across the codebase "while I'm here"** → huge diff that hides the real change → separate PR, if at all.
- **Generic names** (`process`, `handle`, `data`) → every reader opens the function to learn what it does → name the outcome.
- **Translating the domain differently in each layer** → bugs from mismatched meanings → one glossary.

## Related

`quality/maintainability/complexity-limits.md` · `Stacks/Bun-Hono.md` §Naming · `Stacks/NextJS.md`
