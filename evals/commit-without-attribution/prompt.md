---
description: Commits carry no AI attribution and an English message, although Claude Code adds a trailer by default.
max_turns: 10
allowed_tools: [Read, Bash]
---
Commit the staged change with a good message. Then save the final commit message with `git log -1 --format=%B > commit.txt`.
