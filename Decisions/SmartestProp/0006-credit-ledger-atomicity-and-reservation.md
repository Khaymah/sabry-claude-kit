# ADR-0006: Credit Ledger — Atomic Conditional Debit, Pre-Call Reservation, Unbilled-Usage Ledger, Invoice Idempotency

- **Status:** Accepted
- **Date:** 2026-09-04
- **Deciders:** Sabry
- **Project:** SmartestProp
- **Tags:** billing, concurrency, postgres, ai-pipeline
- **Related findings:** SEV-S-012 · SEV-S-013 · SEV-S-018 · SEV-S-019 · SEV-S-020 (Plans/Audit-2026-09-03)

## Context

- `ConsumeCredits` يقرأ الرصيد ثم يفحص الكفاية في JS ثم يكتب `NewBalance` بالـ Id فقط، تحت READ COMMITTED وبلا `FOR UPDATE` وبلا حارس `Balance >= x` وبلا `CHECK (Balance >= 0)`: طلبان متزامنان يخصمان مرة واحدة أو يدفعان الرصيد للسالب. النمط نفسه في `ApplyTopup` و`RefundCredits`.
- `ApplyTopup` يفحص وجود الفاتورة ثم يُدرج (check-then-act) بلا قيد فريد: webhook مكرّر من Stripe يشحن مرتين.
- `UsageLogs.Cost` يُكتب قبل الخصم وبلا transaction تربطهما؛ فشل الخصم يترك سجل استهلاك يدّعي كلفة لم تُحصَّل.
- مسارات AI تنادي المزوّد ثم تفوتر؛ فشل الفوترة بعد التسليم يُبتلع (`catch {}`)، ومسار الأدوات بلا فحص رصيد مسبق أصلاً.

القيود: PostgreSQL + Drizzle؛ لا طابور مهام؛ التقدير المسبق لتكلفة نداء LLM تقريبي (يعتمد على طول المدخل وحدّ الإخراج).

## Decision

1. **خصم ذرّي شرطي:** `UPDATE CreditBalances SET Balance = Balance - :x, TotalConsumed = TotalConsumed + :x, UpdatedAt = now() WHERE Id = :id AND IsDeleted = false AND Balance >= :x RETURNING Balance`؛ صفر صفوف ⇒ `INSUFFICIENT_CREDITS`. الشحن والاسترداد بنفس النمط (`Balance = Balance + :x`). قيد `CHECK (Balance >= 0)` على الجدول.
2. **UsageLogs داخل نفس الـ transaction** بعد نجاح الخصم؛ لا سجل استهلاك بلا خصم مقابل.
3. **حجز مسبق (`CreditHolds`):** قبل أي نداء مزوّد يُحجز تقدير التكلفة (خصم ذرّي إلى حقل `Held`)؛ بعد الرد تُسوّى بالتكلفة الفعلية (فرق يُعاد أو يُخصم)؛ حجوزات أقدم من 10 دقائق بلا تسوية تُحرَّر بمهمة مجدولة وتُسجَّل.
4. **لا ابتلاع:** فشل التسوية بعد التسليم ⇒ صف في `UnbilledUsage` (ClientId · ProviderId · Tokens · Cost · Reason · RequestId) + حدث `Billing.SettlementFailed` + log error؛ تقرير إداري يعرضها؛ لا `catch` صامت.
5. **Idempotency للشحن:** `UNIQUE (InvoiceId)` على جدول الشحنات و`INSERT … ON CONFLICT (InvoiceId) DO NOTHING RETURNING`؛ التكرار يعيد نتيجة الشحنة الأصلية (200 لا 500).

## Considered Options

### Option 1: UPDATE شرطي ذرّي + حجز مسبق + قيد فريد ← المختار
- **Pros:** رحلة DB واحدة للخصم بلا قفل محتفَظ به؛ يغلق الإنفاق المزدوج والشحن المزدوج و«بيع ثم فوترة» معاً.
- **Cons:** migration (جدول الحجوزات + الحقل + القيود) ومسار تسوية للحجوزات اليتيمة؛ التقدير المسبق قد يرفض طلباً كان سيمرّ بهامش صغير.

### Option 2: `SELECT … FOR UPDATE`
- **Pros:** أقل تغيير.
- **Cons:** يحلّ السباق فقط؛ يبقي القفل طوال المعاملة (بما فيها إدراج المعاملات والأحداث) ولا يعالج الفوترة المبتلعة أو غياب الفحص المسبق.

### Option 3: دفتر append-only ورصيد مُشتقّ
- **Pros:** الأصحّ محاسبياً وقابل للتدقيق الكامل.
- **Cons:** إعادة تصميم أسبوع+، وقراءة الرصيد تحتاج مواد ملخّصة؛ يمكن الانتقال إليه لاحقاً فوق هذا القرار (الحركات تُسجَّل أصلاً في `CreditTransactions`).

## Rationale

المحاور الحاكمة: **Reliability** (المال لا يقبل «غالباً صحيح»)، **Security** (إنفاق مزدوج بحساب عادي)، **Cost** (استهلاك غير مفوتر = خسارة مباشرة للمنصة). Performance يُسقَط: الخصم الذرّي أرخص من القراءة-ثم-الكتابة الحالية. القيد `CHECK` هو خط الدفاع الأخير الذي يجعل أي انحدار مستقبلي يفشل بصوت.

## Consequences

### Positive
- ✅ اختبار تزامن قاطع: 20 خصماً متوازياً من رصيد يكفي 10 ⇒ 10 تنجح والرصيد صفر لا سالب.
- ✅ لا استهلاك LLM بلا تغطية رصيد مسبقة؛ لا فوترة تُفقد بصمت.
- ✅ webhook مكرّر آمن بطبيعته.

### Negative (Trade-offs المقبولة)
- ⚠️ حقل/جدول حجوزات جديد وسكربت تسوية مجدول.
- ⚠️ رفض هامشي لطلبات على حافة الرصيد بسبب التقدير المسبق (مقبول؛ يُعرض للمستخدم ككود i18n واضح).

### Risks
- 🚨 تقدير مسبق أقل من الفعلي يُنتج تسوية سالبة تتجاوز الرصيد — Mitigation: التسوية تسمح بالسالب المحدود للحجز المسوّى فقط وتُسجَّل في `UnbilledUsage` عند تجاوز الحدّ، ويُراجَع معامل التقدير شهرياً من البيانات الفعلية.

## Migration Path

1. T-S-11: القيود + الخصم الذرّي + UsageLogs داخل الـ transaction (لا يعتمد على الحجز).
2. T-S-12: الحجز المسبق والتسوية و`UnbilledUsage` عبر `RunPreflight` الموحّد لكل مسارات AI.
3. لاحقاً (اختياري): دفتر append-only فوق `CreditTransactions` عند الحاجة لتدقيق محاسبي كامل.
