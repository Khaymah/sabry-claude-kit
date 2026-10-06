# أدوات فهم الكود

**اختر بالمهمة، لا بترتيب ثابت.**

| المهمة | الأداة |
|---|---|
| "أين يُستخدم X؟" · "أين هذا النص؟" | **Grep / Glob / Read** |
| "ماذا يكسر لو غيّرت X؟" | `get_impact_radius_tool` |
| مراجعة تغييرات + risk score | `detect_changes_tool` → `get_review_context_tool` |
| "ما بنية هذا المشروع؟" | `get_architecture_overview_tool` |
| بحث دلالي بالمعنى | `semantic_search_nodes_tool` ⚠️ معطّل — يحتاج `pip install sentence-transformers` |
| تتبّع callers/callees/imports | `query_graph_tool` · `traverse_graph_tool` |
| مسارات التنفيذ المتأثرة | `get_affected_flows_tool` |
| تخطيط rename / كشف dead code | `refactor_tool` |
| مسح واسع لملفات كثيرة | **Explore subagent** (`model: "opus"`) |

- **Grep/Glob/Read ليست ملاذاً أخيراً** — هي الأساس الموصى به رسمياً، **ولا تتقادم**.
  أدوات الـ graph (30 أداة بلاحقة `_tool`) تتفوّق في **الأثر والعلاقات** لا البحث النصي.
- ⚠️ **تحقّق قبل الوثوق:** `list_graph_stats_tool` — إن كان `files_count` أقل بكثير من حجم
  المشروع أو `head_matches_build`=false، النتائج غير موثوقة → `build_or_update_graph_tool`
  أو Read مباشرة. **graph ناقصة أسوأ من لا graph.**
- ⚠️ **`/mcp` قبل الاعتماد على أي أداة MCP.** لا تفترض أداة لم ترها؛ وإن غابت أكمل بـ Grep.

> قبل بناء شيء جديد: ابحث عن implementation موجود ووسّعه بدل التكرار.
