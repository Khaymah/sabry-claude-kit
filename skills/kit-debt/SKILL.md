---
name: kit-debt
description: "Collects the deliberate shortcuts marked in code (`shortcut: <the limit>, <when to upgrade>`) into a ledger with their location, age and upgrade trigger, so \"later\" does not become \"never\". Use on /sabry-kit:kit-debt, or when the owner asks \"إيه الـ shortcuts اللي في الكود\" / \"الديون التقنية\" / \"tech debt\" / \"what did we defer\"."
argument-hint: "[folder]"
---

# Kit debt — the shortcut ledger

Reply in the owner's language (profile; default Egyptian Arabic).

A shortcut is a comment of exactly this form, in any language's comment syntax:

    shortcut: <the limit>, <when to upgrade>

## 1. Find them

```bash
rg -n --no-heading -e "(//|#|/\*|--|<!--)\s*shortcut:" ${ARGUMENTS:-.} -g '!node_modules' -g '!dist' -g '!build' -g '!.git'
```

No `rg` → `git grep -n -E "(//|#|/\*|--|<!--)\s*shortcut:"`.

For each hit, the age comes from `git blame -L <line>,<line> --date=short <file>` (one call per file is enough: `git blame --date=short <file>` and pick the lines).

## 2. Judge each one

Read the code around it and the upgrade trigger. Mark it:
- **Due**: the trigger has happened (the code shows it: a second server, a bigger table, a paying client, a date passed).
- **Watch**: the trigger is close or cannot be judged from the code.
- **Fine**: the trigger is far.
A shortcut with no trigger after the comma is itself a finding: it cannot be tracked.

## 3. Write the ledger

Write `Plan/debt.md` (replace the previous table, keep any notes the owner added under `## Notes`):

```md
# Shortcut ledger — <date>
| # | Where | The limit | Upgrade when | Since | Status |
|---|---|---|---|---|---|
| 1 | `src/api/RateLimit.ts:12` | in-memory counter | more than one server | 2026-11-02 | Due |
```

Order: Due, then Watch, then Fine; oldest first inside each.

## 4. Report

One short table of the Due ones with the smallest fix for each, then ask with `AskUserQuestion` which to schedule (each becomes a task in the active plan, or a new one). Never fix a shortcut without the owner's go-ahead.
