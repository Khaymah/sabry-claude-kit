# Evals for AI features

- **Situation:** "is the new prompt better", "test the chatbot", "we are upgrading the model", "it worked in my three examples", shipping any feature whose output is generated text.
- **Skip when:** the model only formats data deterministically and a normal unit test covers the result.
- **Decision:** every AI feature ships with a small versioned eval set and a rubric; CI runs it on every prompt, model or retrieval change and fails on a regression against the stored baseline.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | Any AI feature before shipping: 20+ cases, pass/fail checks, a baseline score |
| Standard | In production: CI gate on prompt change, LLM-as-judge with rubric, production samples feed the set |
| Advanced | Quality is the product or regulated: multiple model comparison, human-labelled gold set, per-segment reports |

## Rules

### Minimum — always, never cut

- Before shipping, the feature has an eval set in the repo (`evals/<feature>.jsonl`): input, expected facts or checks, tags. Start with 20 real or realistic cases, include Arabic and mixed-language cases, empty input, very long input, and out-of-scope questions.
- Prefer deterministic checks: valid against the Zod schema, contains or excludes a string, cites a given document, refuses, stays under a length, no personal data. Use them before any judge.
- Include negative and adversarial cases: injection attempts (`prompt-injection.md`), questions with no answer in the documents, requests for prices that do not exist.
- The score is stored as a baseline with the prompt version, model id and date. "Better" means a number against the baseline, not an impression.
- Eval data has no real customer personal data; anonymise or invent.

### Standard — adds

- CI runs the eval set when prompts, system messages, tools, retrieval settings or model ids change (path filter). It fails if the pass rate drops more than the agreed margin (default 2 points) or any must-pass case fails.
- Prompts live in versioned files, not strings scattered in code, so a diff is reviewable and the eval can tag the version.
- LLM-as-judge only with a written rubric: named criteria, a 1–5 or pass/fail scale with definitions, the judge sees the question, the sources and the answer, and returns Zod-validated JSON with a reason. Use a different or stronger model than the one judged; calibrate against 20 human-labelled cases and require agreement before trusting it.
- Run each case 3 times when temperature is above 0 and report the pass rate, not one lucky sample.
- Production feedback (thumbs down, handoffs, corrections) is reviewed weekly and the failures become new cases, with personal data removed.

### Advanced — adds

- Run the set against candidate models before any upgrade; compare quality, latency and cost side by side, then switch through a flag with a rollback.
- Keep a frozen gold set that is never used for prompt tuning, to detect overfitting.
- Report by segment (dialect, document type, tenant size); a gain overall that hurts one segment is visible.
- Scheduled nightly run to catch silent provider-side model changes.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Judge model scores its own style higher | Judge differs from the model under test; rubric checks facts, not style |
| Pass rate drops 1 point | Within margin; with 3 runs per case, noise is measured before blocking |
| New model scores higher overall, fails Arabic dialect cases | Not shipped; segment report shows it |
| Old production conversations violate a new rule | They are added as cases; the set grows, baseline is re-recorded with a note |
| Provider retires or changes a model id | Nightly run fails loudly; no silent fallback to another model |
| Data at 100×: 5,000 cases | Run in parallel with a concurrency cap and a cost budget; tag a 100-case smoke subset for every push, full set nightly |
| Twice / parallel: two PRs change the same prompt | Each CI run scores its own branch against the stored baseline; baseline updates only on merge to main |
| Case with a correct answer that changes over time (a price) | Expected value read from fixtures, not written into the case text |
| Judge returns invalid JSON | Counted as an error, retried once, never as a pass |
| Flaky case | Quarantined with a ticket and a date; not deleted |
| Eval run hits rate limits | Throttled with the adapter's backoff; the run does not report partial results as a pass |

## Example — Standard, Bun + Hono + Drizzle

```ts
const Case = z.object({ Id: z.string(), Input: z.string(), MustContain: z.array(z.string()).default([]), MustNotContain: z.array(z.string()).default([]), ShouldRefuse: z.boolean().default(false), Tags: z.array(z.string()).default([]) })

export async function RunEval(Feature: string) {
  const Lines = (await Bun.file(`evals/${Feature}.jsonl`).text()).split("\n").filter(Boolean)
  const Cases = Lines.map((L) => Case.parse(JSON.parse(L)))
  const Results = await Promise.all(Cases.map((C) => Limit(async () => {
    const Answer = await Features[Feature](C.Input)
    const Ok =
      C.MustContain.every((S) => Answer.Text.includes(S)) &&
      C.MustNotContain.every((S) => !Answer.Text.includes(S)) &&
      Answer.Refused === C.ShouldRefuse
    return { Id: C.Id, Ok, Tags: C.Tags }
  })))
  const PassRate = Results.filter((R) => R.Ok).length / Results.length
  const Baseline = JSON.parse(await Bun.file(`evals/${Feature}.baseline.json`).text()) as { PassRate: number }
  if (PassRate < Baseline.PassRate - 0.02) {
    console.error(Results.filter((R) => !R.Ok).map((R) => R.Id))
    process.exit(1)
  }
  return PassRate
}
```

`Limit` is a concurrency limiter (for example `p-limit`). The judge, when used, is another adapter call with a Zod schema for `{ Score, Reason }`.

Other stacks: the same JSONL file and baseline file work from any test runner; only the runner differs.

## Verify

- [ ] `[M]` `evals/<feature>.jsonl` exists with 20+ cases including Arabic, out-of-scope and empty input.
- [ ] `[M]` A baseline file records pass rate, prompt version, model id and date.
- [ ] `[S]` Changing the prompt file triggers the eval job in CI; a deliberately broken prompt fails it.
- [ ] `[S]` The judge rubric exists in the repo and agreement with human labels is recorded.
- [ ] `[A]` A model upgrade PR carries the side-by-side report and a rollback flag.

## Pitfalls

- **Judging with a vague "rate this answer"** → noisy, favours verbose answers → rubric with criteria.
- **Tuning the prompt on the same cases you report** → inflated score → frozen gold set.
- **Testing only happy English cases** → dialect and refusal bugs ship → required tags.
- **Exact string equality on generated text** → brittle → facts and constraints.
- **Updating the baseline to make CI pass** → hides regressions → only on merge, with a reason.

## Related

`quality/testability/test-strategy.md` · `ai/prompt-injection.md` · `ai/rag.md` · `ai/chatbots.md` · `ai/cost-limits.md` · `ai/llm-calls.md`
