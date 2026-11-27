# Frontend playbooks

Pick 1–3 files whose situation matches the task. File paths in this table are relative to this folder; paths inside playbooks are relative to `Playbooks/`. `planned` = not written yet: work without it and say so.

Example stack in every file: Next.js (App Router) + React + TypeScript + Tailwind + TanStack Query + react-hook-form + Zod. Other frameworks: same rules, adapt the API calls.

## Screens and data

| Situation | File | Status |
|---|---|---|
| A form: validation, server errors on fields, double submit, phone and money inputs, "unsaved changes" | `forms.md` | ✅ |
| Loading data, query keys, stale data after switching company or branch, refresh after save | `data-fetching.md` | ✅ |
| "Make it feel instant": like, toggle, drag, inline edit, and where instant is wrong | `optimistic-ui.md` | ✅ |
| Big table or list: filters, sort, pages, export, thousands of rows | `tables-large-data.md` | ✅ |
| Every list, page or widget: empty, loading, error, partial failure | `four-states.md` | ✅ |

## Language, access, people

| Situation | File | Status |
|---|---|---|
| Arabic RTL, mirrored layout, numbers, dates, currency, mixed Arabic and English text | `rtl-i18n.md` | ✅ |
| Keyboard, screen readers, modals, focus, contrast, error announcement | `accessibility.md` | ✅ |
| Login screens, protected pages, token refresh, logout, hiding buttons by role | `auth-ui.md` | ✅ |
