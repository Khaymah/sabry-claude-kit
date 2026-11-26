import sys, os
case, desc, level, kind, cls = sys.argv[1:6]
body = sys.stdin.read().strip()
end = "نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر."
fm = f'''---
description: "{desc}"
tags: [{level}, {kind}, {cls}]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

'''
open(f"/home/user/bench2/cases/{case}/prompt.md", "w").write(fm + body + "\n\n" + end + "\n")
