# Refactoring safely

- **Situation:** changing the structure of existing code without changing behaviour; cleaning up before or while adding a feature; renaming, moving, splitting, replacing a library.
- **Skip when:** the code works, nobody needs to change it soon, and it is only "ugly". Refactor what the next change touches.
- **Decision:** refactor in a separate commit (or PR) from behaviour changes, under tests that pin the current behaviour, in steps small enough that each one keeps everything green.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Local cleanup inside the files a task already touches |
| Standard | Moving or renaming across modules, replacing a dependency |
| Advanced | Changing a data model or contract that live clients depend on |

## Rules

### Minimum — always, never cut

- No refactor without a test that covers the behaviour being moved. No test → write a characterization test first (asserts what the code does today, even if odd).
- Refactoring and behaviour change never share a commit. Commit message prefix `refactor:` means "no behaviour change".
- Run the typecheck and tests after each step, not at the end.
- Grep every caller before changing a signature; update them in the same commit.

### Standard — adds

- "Make the change easy, then make the easy change": the refactor PR lands first, the feature PR is small.
- Replacing a library: wrap the old one behind the module's function first, switch callers to the wrapper, then swap the implementation inside it.
- Moves and renames use the editor's or the language server's refactor (or `ts-morph`), not search-and-replace.
- A refactor PR states the scope ("Orders module only") and is reviewable in under 30 minutes; bigger ones are split.

### Advanced — adds

- Strangler pattern for large rewrites: new path behind a feature flag, traffic moved gradually, old path deleted when the flag is at 100% for a release.
- Data-model changes follow expand → migrate → contract (`backend/data/migrations.md`); API changes follow versioning (`backend/api/versioning.md`).
- Dual-run comparison for risky logic (pricing, permissions): run old and new, log differences, switch when they are zero for a period.

## Edge cases

| Case | Expected behaviour |
|---|---|
| The odd behaviour the characterization test pins is a bug | Keep it in the refactor; fix it in a separate commit with its own test, and say so in the report |
| No tests at all and no time to write them | Refactor only what the type checker can prove (renames, moves); stop before logic changes |
| Refactor reveals dead code | Delete it in its own commit after confirming no caller (`grep`, route logs) |
| Generated code or vendor code | Never hand-refactor; change the generator or wrap it |
| Refactor grows beyond the plan | Stop, commit the green part, list the rest as debt |

## Example — Standard

```bash
git commit -m "test(orders): pin current tax rounding before refactor"
git commit -m "refactor(orders): extract tax calculation to Orders.Tax.ts"
git commit -m "feat(orders): support tax-inclusive prices"
```

```ts
import { CalculateTax } from "./Orders.Tax"
export { CalculateTax }
```

The second block is the barrel left in the original file, so existing imports keep working while callers move.

## Verify

- [ ] `[M]` Tests and typecheck green after every refactor commit.
- [ ] `[M]` Refactor commits change no test expectations (only additions).
- [ ] `[M]` `git diff` of a `refactor:` commit shows no new behaviour (no new branches, no changed outputs).
- [ ] `[S]` Old library is imported only from its wrapper before the swap.
- [ ] `[A]` Dual-run difference log is empty for the agreed period before switching.

## Pitfalls

- **Big-bang rewrite** → months without shipping, then regressions → strangler, step by step.
- **Refactor + feature in one PR** → reviewers can't see what changed behaviour → separate commits.
- **"Improving" code nobody touches** → risk with no payoff → refactor what the next change needs.

## Related

`quality/maintainability/tech-debt.md` · `quality/testability/test-strategy.md` · `practices/feature-flags.md`
