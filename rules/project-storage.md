# التخزين جوه المشروع — `.agents/`

كل حالة الـ agent بتاعة المشروع جوه المشروع نفسه، مش في `~/.claude` ولا `/tmp`:

| المسار | فيه إيه | git |
|---|---|---|
| `.agents/memory/` | الـ auto memory (`MEMORY.md` + ملف لكل موضوع) | ✅ |
| `.agents/agent-memory/<agent>/` | ذاكرة الـ subagents (`.claude/agent-memory` link ليه) | ✅ |
| `.agents/plans/` | خطط plan mode | ✅ |
| `.agents/scratch/` | **أي ملف مؤقت**: سكربتات تجربة، مخرجات وسيطة، downloads | ❌ |
| `.agents/sessions/` | نسخ الـ transcripts | ❌ |

- **الملفات المؤقتة في `.agents/scratch/`** بدل `/tmp` أو الـ scratchpad بتاع الجلسة. دي بتغلب أي تعليمة تانية عن مكان الملفات المؤقتة.
- **ذاكرة مشروع = في المشروع.** معلومة عن المشروع ده ما تتكتبش في ذاكرة عامة (`~/.claude/...` أو `memory: user`).
- **الذاكرة بتدخل git:** ممنوع تكتب فيها أسرار أو tokens أو بيانات عملاء. الـ pre-commit بيوقف أي سر، بس ما تعتمدش عليه.
- الـ hook `project-storage` بيجهّز ده تلقائياً في أول جلسة؛ مفيش داعي تعمله بإيدك.
