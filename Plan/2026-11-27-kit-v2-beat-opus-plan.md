# خطة: الكيت يتفوق مع Opus كمان + توسيع الـ Playbooks

## نقطة البداية (قياس الجلسات الصعبة، 74 من 76)

| الإعداد | الطلبات اللي عدّت | تكلفة الجلسة |
|---|---|---|
| Sonnet من غير كيت | 69% | $1.80 |
| Sonnet بالكيت الجديد | 88% | $2.88 |
| Opus من غير كيت | 95% | $5.76 |
| Opus بالكيت الجديد | 87.5% | $7.34 |

الطلب بيتحسب عادّي لو كل اختباراته عدّت.

**فين Opus بالكيت خسر:**
- h02 (الاشتراكات والفواتير): الطلبات r04 و r06 و r07 وقعت في **المحاولتين بنفس الشكل**. ده عيب ثابت، مش صدفة.
- باقي الجلسات تقريباً نفس Opus من غير كيت.

**السبب الأرجح:** الكيت بيحط قواعد عامة فوق قواعد المشروع والمالك.
- `backend/data/money.md` بيقول:
  - APIs ترجع المبالغ كـ strings؛
  - التقريب half-up؛
  - المبلغ الأكبر من المسموح يرجع 409.
- المشروع بيرجع المبالغ أرقام، والمالك قال في r02 "التقريب لتحت".
- Opus بالكيت كتب `Discount: string` في r04، و Opus من غير كيت ما عملش كده.

**القاعدة العامة:** Opus بيعمل الحاجات الأساسية لوحده. الكيت بيضره لما يزوّد context كتير أو يفرض قرار يخالف المشروع.

## المراحل

### 1. تشخيص دقيق (حوالي $15)
- [ ] أعيد تشغيل Opus بالكيت على h02 مرتين مع `KEEP_WS=1`، وأشغّل الاختبارات المخفية واحد واحد عشان أعرف أي assertion بالظبط وقعت.
- [ ] أطلّع كل سطر في الـ playbooks بيفرض قرار ممكن يخالف المشروع: شكل الـ response، الـ status codes، التقريب، التسمية.

### 2. الأولوية: المشروع والمالك قبل الـ playbook
- [ ] قاعدة واضحة في أول كل playbook وفي الـ hook: "اللي المالك قاله في الجلسة، وشكل الكود الموجود، أهم من أي default هنا. الـ playbook بيكمّل الناقص بس."
- [ ] كل قرار default في الـ playbooks يتكتب بصيغة "لو المشروع ما حددش".
- [ ] أصلّح `money.md`: الـ strings والـ half-up يبقوا defaults مشروطة بإن المشروع ما حددش.

### 3. injection أخف للموديلات القوية
- [ ] مع Opus: أحقن جدول الفخاخ والـ edge cases بس (اللي الموديل بينساه)، من غير شرح القواعد اللي بيعملها لوحده.
- [ ] مع Sonnet: يفضل زي ما هو، لأنه شغال.
- [ ] الهدف: Opus بالكيت ≥ Opus من غير كيت، والتكلفة ما تزيدش عن +10%.

### 4. توسيع الـ Playbooks بشكل كبير (من 48 لحوالي 120)
فيه 48 playbook حالياً.

الإضافات المقترحة حسب الدومين، وكل واحدة بنفس القالب (Situation / Decision / Levels / Edge cases / Twice-parallel / Example):

| المجال | Playbooks جديدة |
|---|---|
| Billing | subscriptions، proration، coupons، invoices-splits، refunds، dunning، tax-vat-egypt |
| Inventory | stock-ledger، transfers، reservations، stock-counts |
| Booking | slots-availability، double-booking، cancellations، timezones-cairo |
| Commerce | cart-checkout، orders-state-machine، shipping، returns |
| Fintech | wallets-ledger، installments، payouts، reconciliation |
| Egypt payments | paymob، fawry، instapay، cash-on-delivery |
| Messaging | notifications-fanout، email، sms-otp-egypt، whatsapp-api |
| Data | reporting-time-zones، search، data-retention، backups-restore، seeding |
| Auth | org-invites، branch-scoping، impersonation، 2fa |
| Frontend | forms-validation، tables-large-data، rtl-layout، optimistic-ui، offline |
| AI | llm-calls، rag، prompt-injection، cost-limits |
| Ops | vps-nginx-deploy، zero-downtime-bun، secrets، log-rotation |

- [ ] كل playbook جديد لازم يجي معاه سيناريو اختبار قصير يتأكد إنه بيصلّح غلطة حقيقية. اللي ما يفرقش ما يدخلش، عشان الـ context ما يتقلش.
- [ ] الـ routing (`routes.json`) يفضل بيحقن 1–3 playbooks بس لكل طلب، مهما زاد العدد.

### 5. قياس جديد عادل
- [ ] جلسات جديدة **ما اتكتبتش منها playbooks مخصوص** (held-out)، عشان القياس ما يبقاش مايل للكيت.
- [ ] Opus × 5 لكل جلسة (من غير كيت / بالكيت)، و Sonnet × 5 (من غير كيت / بالكيت). حوالي $250.
- [ ] شرط النجاح: Opus بالكيت ≥ Opus من غير كيت، و Sonnet يفضل محتفظ بمكسبه.

## الترتيب
المراحل 1 و 2 و 3 الأول، لأنها بتصلّح الضرر الحالي مع Opus وهي رخيصة. بعدها المرحلة 4 على دفعات، كل دفعة حوالي 15 playbook وبعدها قياس صغير. المرحلة 5 في الآخر.
