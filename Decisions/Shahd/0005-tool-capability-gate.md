# ADR-0005: بوابة قدرات مركزية لأدوات الـ Agent (tool capability gate)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Deciders:** Sabry
- **Project:** Shahd
- **Tags:** security, tools, agent, architecture

## Context

Phase 7 أضاف نظام tools غني (20+ أداة) مدمج في المودل. بعضها يمسّ أسطحاً خطرة: filesystem (read/write/search)، code execution (run_code)، network (web_search)، والتفاعل البشري (user_ask). توجيه Sabry الدائم: **الأمان أولوية مطلقة في أماكن مخصّصة قابلة للتحكم** (راجع [[shahd-safety-performance-priority]]، ومبدأ GuardedGenerate). أداة filesystem بلا حدود = ثغرة path-traversal؛ user_ask بلا حارس = تعليق السيرفر headless.

## Decision

**بوابة واحدة مركزية** تعكس سابقة Safety/Limits:

1. **قسم `Config.Tools`** (FileAccess: Off/ReadOnly/ReadWrite · ExecEnabled · WorkspaceRoot · WebSearchEnabled · MaxToolSteps · MaxFileBytes) هو المصدر الوحيد للتحكم. **exec + writes = OFF افتراضياً**؛ file = ReadOnly افتراضياً.
2. **`BuildToolRegistry(policy)`** يسجّل الأدوات الآمنة دائماً، ويبوّب الخطرة: run_code يحتاج ExecEnabled؛ file reads تحتاج FileAccess≥ReadOnly؛ file writes تحتاج ReadWrite.
3. **`Workspace`** يحصر كل أداة filesystem داخل Root ويرفض أي path يتسلّل خارجه (resolve ثم prefix-check).
4. **`ToolContext`** يحقن القدرات (session/workspace/providers/clock/rng)؛ الأسطح الخطرة **غائبة افتراضياً**: بلا AskUser → user_ask يُرجع خطأ (لا يعلّق أبداً)؛ بلا WebSearch → stub offline مُعلَّم (بلا اعتماد شبكة صلب).
5. **`BuildAgentTooling(Config)`** هو نقطة الإنفاذ الوحيدة end-to-end: يقرأ **كل** حقول `Config.Tools` (FileAccess/ExecEnabled/WebSearchEnabled→registry، WorkspaceRoot→Workspace، MaxFileBytes→context، MaxToolSteps→agent budget) ويبني registry+context+budget جاهزة. serving/agent ينادونه بدل بناء يدوي بقيم حرفية — فالبوابة فعلاً المصدر الوحيد (مُتحقَّق بـ test يغيّر WorkspaceRoot/MaxFileBytes ويثبت تغيّر السلوك).

## Considered Options

### Option 1: أدوات بوصول حر (fs/exec مفتوح)
- **Cons:** ثغرة أمنية مباشرة؛ يخالف مبدأ Sabry المطلق؛ لا مكان مركزي للتحكم.

### Option 2: بوابة قدرات مركزية config-driven ← المختار
- **Pros:** الأمان في مكان واحد يُقوَّى/يُضعَّف؛ الوضع الافتراضي آمن (deny by default)؛ workspace confinement؛ providers محقونة بدوال آمنة non-interactive.
- **Cons:** طبقة تهيئة إضافية (مقبولة).

## Consequences

- الأدوات inert حتى تُوسَّع صراحةً في config؛ InferenceServer headless لا يعلّق ولا يصل شبكة.
- CodeExecutor يبقى seam يُركَّب فوقه container/gVisor للإنتاج (كما في تعليقه). أي أداة خطرة جديدة تمرّ عبر نفس البوابة.
