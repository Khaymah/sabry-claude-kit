---
name: team-review
description: Runs a parallel multi-agent review of code changes across security, correctness, tests, and UX, then adversarially verifies every finding before reporting. Use on /team-review, or when the user says "راجعوا" / "مراجعة فريق" / "team review" / "راجع الـ PR" / asks for a thorough review before shipping.
argument-hint: "[مسار | رقم PR | فارغ = آخر التغييرات]"
model: sonnet
---

# Team review

Reply in the owner's language (profile; default Egyptian Arabic).

Parallel multi-angle review, then **adversarial verification** of every finding before showing it.

`$ARGUMENTS` = what to review. Empty -> latest changes.

---

## 1. Define scope first

```bash
git diff --stat HEAD          # uncommitted changes
git diff --stat main...HEAD   # whole branch
```

- **Diff empty and no `$ARGUMENTS`?** Stop and ask via `AskUserQuestion` what to review. Never review the whole repo.
- **Under ~3 files and a simple change?** Review it yourself directly. **Don't launch a team**: coordination cost exceeds the benefit. Tell the owner in one line that you chose direct review and why.

## 2. Pick angles by what actually changed

Don't always launch all four. Each angle has an activation condition:

| Angle | agent | Activate when |
|---|---|---|
| Correctness and safety | `code-reviewer` | **always** |
| Security | `security-reviewer` | auth · secrets · user input · file paths · external requests · payments · personal data |
| Tests | `qa-tester` | new or modified logic with branches |
| UI | `ui-ux` (review mode) | `.tsx`/`.jsx`/`.vue`/CSS files or anything the user sees |
| Infrastructure | `devops-sre` | Dockerfile · CI · k8s · deploy config |

## 3. Launch in parallel

All calls in **one message** so they truly run in parallel.

```
Agent(subagent_type: "<name>", run_in_background: true,
      prompt: "Review this diff from your angle. Scope: <files>.
               Report everything you find, including low-confidence and low-severity,
               with confidence and severity for each finding. Do not filter yourself.")
```

Kit agents take their model from their own frontmatter: do not pass `model` to them. Built-in agents (`Explore`) get `model: "sonnet"` explicitly.

Use `SendMessage` to ask a teammate for clarification; it resumes with full context.

## 4. ⚠️ Verify adversarially: the step that makes the difference

**Never show reviewers' findings as-is.** A reviewer is steered toward coverage, not precision, so it will produce false positives
by design. Filtering is your job.

For each significant finding, launch a verifier whose task is **refutation**:

```
Agent(subagent_type: "Explore", model: "sonnet",
      prompt: "Try to refute this claim: '<finding>'.
               Read the actual code. Is the stated path really reachable?
               Is there a guard the reviewer missed?
               Default: REFUTED if you cannot prove the path.")
```

**Show only what survived.** State how many findings fell: that number tells the owner the review's own quality.

## 5. Report

Owner-facing template (headings stay in Arabic):

```md
## 🔍 مراجعة الفريق — <النطاق>

**الزوايا:** <المُفعَّلة> · **النتائج:** <مؤكَّدة> مؤكَّدة من <إجمالي> (سقطت <n> في التحقق)

### 🔴 يمنع الشحن
- `file.ts:42` — <ما ينكسر> · **يحدث حين:** <مدخل أو حالة محددة> · **الإصلاح:** <جملة>

### 🟡 يجب إصلاحه
### 🟢 يستحق النظر

### ✅ ما فُحص ووجد سليماً
<حتى لا يُعاد فحصه>
```

(Template legend: scope · angles activated · confirmed of total (n dropped in verification) · blocks shipping: what breaks / happens when: specific input or state / fix: one sentence · should fix · worth considering · checked and found sound, so it isn't rechecked.)

**Describe the fix, don't write the corrected code**, unless explicitly permitted (CLAUDE.md §2).

No findings? Say so in one line. **Don't manufacture findings to look useful.**

---

## When not to use this skill

- One-line change or typo fix
- Code not yet written: review **after** implementation
- The owner is asking a question about the code, not requesting a review
