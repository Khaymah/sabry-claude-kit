---
name: kit-stats
description: Shows where this project's tokens went - per session input/cache/output, a relative cost index, which tools inflate the context, the largest results, re-read files, full reads of big files and subagent spend - with concrete savings. Use for `/sabry-kit:kit-stats`, "tokens", "cost", "usage", "استهلاك التوكنز", "ليه الجلسة غالية".
---

# kit-stats

Reply in the owner's language (profile; default Egyptian Arabic).

The kit folder is two levels above this skill's base directory.

1. Run the report. Sessions are recorded automatically at SessionEnd; `--current` measures the running session:

```bash
python3 "<kit>/hooks/usage.py" report --last 10
python3 "<kit>/hooks/usage.py" report --current
```

2. Show the table as printed, then at most 3 savings, each tied to a number from the report:
   - the single biggest driver (a tool, a file, a long session),
   - what to change (a habit, a profile switch, `/compact`, a narrower subagent brief),
   - how much it should save, as an estimate from the numbers shown.
3. No recorded sessions yet: show `--current` and say recording starts at the end of each session.

Cost index weights: uncached input 1 · cache write 1.25 (5m) / 2 (1h) · cache read 0.1 · output 5, per 1k tokens. It compares sessions; it is not a price.
