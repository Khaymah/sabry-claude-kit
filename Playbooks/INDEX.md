# Playbooks — router

Atomic best-practice files: one situation, one decision, one way to verify it. **Never read this folder wholesale.**

## How to use

1. Find the domain below from the task (keywords are matched in English or Arabic).
2. Read that domain's `INDEX.md` and pick **1–3 files** whose "Situation" matches the task.
3. Apply each file's **Decision** and run its **Verify** list before you call the work done. Name the playbooks you followed in the report (`Playbooks: backend/auth/password-reset`).
4. The project's own code and the owner's profile win over a playbook. A playbook wins over your general habit.
5. No matching file → work as usual and say "no playbook" in the report; don't invent one.

## Domains

| Domain | INDEX | Keywords |
|---|---|---|
| Backend | `backend/INDEX.md` | API · endpoint · auth · login · password · session · schema · migration · money · payment · webhook · queue · job · upload · cache · rate limit · باك اند · تسجيل دخول · فلوس · دفع · رفع ملفات |
| Frontend | `frontend/INDEX.md` | form · state · fetching · routing · i18n · RTL · a11y · performance · فورم · واجهة · عربي |
| Security | `security/INDEX.md` | secrets · headers · CORS · CSRF · XSS · injection · permissions · PII · أمان · صلاحيات |
| DevOps | `devops/INDEX.md` | deploy · VPS · Nginx · TLS · backup · logs · monitoring · CI · نشر · سيرفر · باك اب |

Stack-specific rules stay in `Stacks/`; a playbook links to them instead of repeating them.
