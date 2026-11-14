---
name: kit-orchestrate
description: Coordinates several sabry-kit agents on one multi-step job through a fixed playbook (feature, bugfix, product idea, release, integration, support ticket, client offer) with one shared handoff file, parallel independent steps and a coverage check at the end. Use on /kit-orchestrate, or when the owner says "نسّق الفريق" / "شغّل الفريق على" / "feature كاملة من الأول للآخر" / "orchestrate" / asks for work that clearly needs three or more roles.
argument-hint: "[feature | bugfix | idea | release | integration | support | offer] <what to do>"
---

# Kit orchestrate

Reply in the owner's language (profile; default Egyptian Arabic). You are the coordinator: subagents cannot launch subagents, so every step is launched from here.

`$ARGUMENTS` = the playbook (optional) and the job.

## 0. Is orchestration worth it?

Each agent rebuilds its context, so a team costs several times a single pass.

- **One or two files, one role, or a question:** do it directly. Say in one line that you skipped the team and why.
- **Three or more roles, or independent tracks:** continue.
- Job unclear (which playbook, what "done" means, what is out of scope): ask once with `AskUserQuestion`, options with a trade-off each, before launching anything.

## 1. Number the request

Split the owner's request into numbered items (`R1`, `R2`, …), one verifiable outcome each, and show them. Everything later refers to these numbers. Section 6 closes each one.

## 2. Pick the playbook

`→` is sequential, `∥` is parallel (one message, several `Agent` calls).

| Playbook | Sequence | Skip a step when |
|---|---|---|
| **feature** | `senior-pm` → `cto` → (`backend-architect` ∥ `Frontend Developer` ∥ `mobile-developer`) → `qa-tester` → `code-reviewer` | no product question → skip `senior-pm` · no load-bearing decision → skip `cto` · only the sides the feature touches |
| **bugfix** | `senior-engineer` (root cause, no fix yet) → `senior-engineer` (fix) → `qa-tester` (regression test) | cause already proven → start at the fix |
| **idea** | `market-researcher` → `senior-pm` → `business-analyst` → `cto` | decision is Stop → end there |
| **release** | (`devops-sre` ∥ `security-reviewer`) → `tech-writer` | nothing internet-facing changed → skip `security-reviewer` |
| **integration** | `integration-engineer` (design from the provider's docs) → `senior-engineer` or `integration-engineer` (build) → (`security-reviewer` ∥ `qa-tester`) | design already approved → start at the build |
| **support** | `support-triage` → `senior-engineer` (fix) → `qa-tester` (regression test) → `proposal-writer` (client reply, only when it is long or sensitive) | not a bug → end at triage with the reply |
| **offer** | `business-developer` → `proposal-writer` | deal terms already agreed → skip `business-developer` |

Add `ui-ux` before the frontend step when a new screen is designed, `Database-Optimizer` beside the backend step when the schema or a heavy query changes, `ai-engineer` when the feature calls an LLM, `data-analyst` when the job starts from a number nobody has checked. Never add a role "to be safe".

The default working mode still holds: without "نفّذ" / "implement" from the owner, implementation steps produce a plan and tasks, not code.

## 3. One handoff file

Create `.agents/plans/<slug>/handoff.md` (use `kit_plans.py new` first when the job is long enough for a checkbox plan; the handoff sits beside `plan.md`). It starts with the numbered request, the playbook and the constraints from the project brief.

Every step **appends** one section and nothing else:

```md
## <n>. <agent> — <what it was asked>
- Decided: <decisions, one line each, with the R-numbers they serve>
- Files: <path:line touched or to touch>
- For the next step: <what it must know; what is already ruled out>
- Open: <questions only the owner can answer, or "none">
```

At most 200 words per section. Long output (a spec, a schema, a report) goes in its own file next to the handoff and the section links to it.

## 4. Brief each step

```
Agent(subagent_type: "<agent>", prompt:
  "Goal: <one line> — done when <acceptance>.
   Read <handoff path> first; do not re-explore what it already covers.
   Scope: <files or area>. May edit: <yes: which files | no>.
   Serve R<n>, R<m>.
   When finished, append your section to the handoff (format in the file).
   Reply with at most 150 words: what you decided, what you changed, what is open.")
```

- Do not pass `model`; each kit agent's frontmatter sets it.
- Independent steps go in **one message** so they run in parallel. Two agents never edit the same file in the same step.
- A step reports an `Open` question for the owner → ask it with `AskUserQuestion` before the steps that depend on it; continue the ones that do not.
- A step fails or contradicts an earlier decision → stop the sequence, show the conflict, ask.

## 5. Quality gates

Between implementation and "done", in this order:

1. **Checks:** the project's typecheck, the tests for the changed files, lint (commands are in the project brief). Run them here in the main loop, not in a subagent.
2. **Definition of done** for the task type (`rules/completion-discipline.md`).
3. **Clean-context review:** `code-reviewer` gets the diff and the numbered request only, never the handoff or your reasoning. Required when the change is over ~150 lines or 5 files, or touches auth, payments, migrations or personal data. Fix blockers, then re-run step 1.

## 6. Close every item

```md
## ✅ <job> — النتيجة
| # | المطلوب | الحالة | الدليل |
|---|---|---|---|
| R1 | … | اتنفّذ / اتنفّذ جزئياً / ما اتنفّذش | `path:line` · اسم الاختبار · أو السبب |

**اتحقق منه:** <الأوامر اللي اشتغلت ونتيجتها> · **ما اتحققش منه:** <وليه>
**مفتوح:** <قرار مستني المالك، أو "لا شيء">
```

Every `R` appears, including the ones not done, with the reason. Tick the plan's boxes and add the usual `Plan/Progress/` section. Then ask the owner what is next with `AskUserQuestion`.

## When not to use this skill

- A change in one or two files, a question, or a review (use `team-review` for reviews).
- The owner asked for one specific agent by name.
- Steps that cannot be separated: one agent with the whole context does better than three with a third each.
