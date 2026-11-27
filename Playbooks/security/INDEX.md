# Security playbooks

Pick 1–3 files whose situation matches the task. Most security decisions live next to the feature they protect, so this index points into `backend/` as well. `planned` = not written yet: work without it, follow `Roles/Cyber-Security.md`, and say so.

| Situation | File | Status |
|---|---|---|
| Brute force on sign-in, credential stuffing, OTP or reset abuse, scraping | `../backend/reliability/rate-limit.md` | ✅ |
| Sign-in, sessions, tokens, "log out of all devices" | `../backend/auth/sessions.md` | ✅ |
| Forgot password, magic links, email verification | `../backend/auth/password-reset.md` | ✅ |
| OTP and two-factor | `../backend/auth/otp.md` | ✅ |
| Roles, permissions, IDOR ("a user saw another user's order") | `../backend/auth/rbac.md` | ✅ |
| One company seeing another company's data | `../backend/data/multi-tenancy.md` | ✅ |
| API keys and webhook signing secrets | `../backend/auth/api-keys.md` | ✅ |
| Uploaded files: type checks, private documents, serving safely | `../backend/files/uploads.md` | ✅ |
| CSV and Excel formula injection | `../backend/files/import-export.md` | ✅ |
| Secrets in code, env and logs; rotation | `secrets.md` | ✅ |
| Security headers, CORS, CSRF, cookies | `headers-cors-csrf.md` | ✅ |
| Injection: SQL built from strings, XSS, SSRF | `injection.md` | ✅ |
| Personal data, retention, export and deletion requests | `personal-data.md` | ✅ |
