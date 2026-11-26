# Technical debt

- **Situation:** taking a shortcut to ship, a `TODO`, "we'll fix it later", deciding what to clean up, a client asking why a small change takes long.
- **Skip when:** a prototype that will be thrown away, and everyone agreed it will.
- **Decision:** debt is allowed only when it is deliberate, written down where the next person will see it, and has a trigger for paying it back. Unrecorded shortcuts are bugs.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Every project: shortcuts are marked in code |
| Standard | Production apps: a debt register exists |
| Advanced | Long-lived products: debt is budgeted |

## Rules

### Minimum — always, never cut

- A deliberate shortcut is marked in code as `// shortcut: <the limit>, <when to upgrade>` (owner rule), e.g. `// shortcut: in-memory rate limit, move to Redis at 2 instances`.
- No bare `TODO` / `FIXME`: either it becomes a `shortcut:` line with a trigger, or an item in the plan, or it is done now.
- Never take debt on the security floor, data integrity, backups, or money calculations.

### Standard — adds

- `.agents/memory/debt.md` (or the issue tracker) lists each item: what, where (path), why it was taken, the trigger, the cost if ignored, rough size.
- The kit's `kit-debt` skill collects `shortcut:` lines into the register; run it before planning a release.
- When a task touches code with a recorded debt item and the trigger has fired, pay it in the same task (separate commit) or say why not.

### Advanced — adds

- A fixed share of each cycle (about 15–20%) goes to the top items, chosen by hot spot (churn × complexity) and by the triggers that fired.
- Debt items appear in client reports as risk, with the cost of not paying.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The client refuses time for cleanup | Record the item and its risk in the register and the handoff; never hide it |
| A shortcut's trigger is already reached when found | Treat it as a bug in the current task's report |
| Debt in a dependency (old major version) | Register item with the version, the end-of-life date and the upgrade path |
| A prototype becomes production | Run `kit-debt` and a `project-audit` before the first real user; Minimum items become Standard |

## Example

```ts
// shortcut: emails sent inline, move to the job queue before 100 orders/day
await SendOrderConfirmation(Order)
```

```md
| Item | Path | Why taken | Trigger | Cost if ignored | Size |
|---|---|---|---|---|---|
| Inline emails | Src/Modules/Orders/Orders.Service.ts | Launch date | 100 orders/day | Slow checkout, lost emails on SMTP errors | S |
```

## Verify

- [ ] `[M]` `grep -rn "TODO\|FIXME" Src/` returns nothing new; every shortcut has a trigger.
- [ ] `[S]` Every `shortcut:` line appears in the register (`kit-debt` output matches).
- [ ] `[A]` The register was reviewed this month; the top three items have owners.

## Pitfalls

- **Silent shortcuts** → the next developer (or agent) builds on them as if they were intended → mark them.
- **A cleanup sprint "one day"** → never happens → pay debt when the code is touched and the trigger fired.
- **Calling every disliked pattern "debt"** → the register loses meaning → debt has a cost and a trigger, taste does not.

## Related

`quality/maintainability/refactoring.md` · `skills/kit-debt/` · `rules/smallest-change.md`
