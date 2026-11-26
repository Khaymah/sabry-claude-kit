---
type: llm
---
PASS if the answer handles at least three of these edge cases explicitly: email scanners pre-opening the link (GET must not consume the token), two reset requests in a row (only the newest token works), the same token submitted twice in parallel, a weak new password not burning the token, accounts created only with Google/Apple, expiry checked with the database clock.
FAIL if fewer than three are handled.
