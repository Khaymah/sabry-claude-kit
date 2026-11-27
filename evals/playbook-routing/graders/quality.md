---
type: llm
---
PASS if the design stores only a hash of the reset token, gives it a short expiry and single use, answers the same way whether the email exists or not, and revokes the user's existing sessions after the reset.
FAIL if the token is stored in plain text, is a JWT, the response reveals whether the account exists, or sessions stay alive after the reset.
