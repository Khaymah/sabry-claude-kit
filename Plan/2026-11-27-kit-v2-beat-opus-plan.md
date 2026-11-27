# خطة: الكيت يتفوق مع Opus كمان + توسيع الـ Playbooks

## نقطة البداية (قياس الجلسات الصعبة، 76 من 76)

| الإعداد | الطلبات اللي عدّت | تكلفة الجلسة |
|---|---|---|
| Sonnet من غير كيت | 69% | $1.80 |
| Sonnet بالكيت الجديد | 88% | $2.87 |
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
- [x] أعيد تشغيل Opus بالكيت على h02 مرتين مع `KEEP_WS=1`، وأشغّل الاختبارات المخفية واحد واحد عشان أعرف أي assertion بالظبط وقعت.
- [x] أطلّع كل سطر في الـ playbooks بيفرض قرار ممكن يخالف المشروع: شكل الـ response، الـ status codes، التقريب، التسمية.

### 2. الأولوية: المشروع والمالك قبل الـ playbook
- [x] قاعدة واضحة في أول كل playbook وفي الـ hook: "اللي المالك قاله في الجلسة، وشكل الكود الموجود، أهم من أي default هنا. الـ playbook بيكمّل الناقص بس."
- [x] كل قرار default في الـ playbooks يتكتب بصيغة "لو المشروع ما حددش".
- [x] أصلّح `money.md`: الـ strings والـ half-up يبقوا defaults مشروطة بإن المشروع ما حددش.

### 3. injection أخف للموديلات القوية
- [x] مع Opus: أحقن جدول الفخاخ والـ edge cases بس (اللي الموديل بينساه)، من غير شرح القواعد اللي بيعملها لوحده.
- [x] مع Sonnet: يفضل زي ما هو، لأنه شغال.
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

- [x] كل playbook جديد لازم يجي معاه سيناريو اختبار قصير يتأكد إنه بيصلّح غلطة حقيقية. اللي ما يفرقش ما يدخلش، عشان الـ context ما يتقلش.
- [x] الـ routing (`routes.json`) يفضل بيحقن 1–3 playbooks بس لكل طلب، مهما زاد العدد.

### 5. قياس جديد عادل
- [x] جلسات جديدة **ما اتكتبتش منها playbooks مخصوص** (held-out)، عشان القياس ما يبقاش مايل للكيت.
- [ ] Opus × 5 لكل جلسة (من غير كيت / بالكيت)، و Sonnet × 5 (من غير كيت / بالكيت). حوالي $250.
- [ ] شرط النجاح: Opus بالكيت ≥ Opus من غير كيت، و Sonnet يفضل محتفظ بمكسبه.
- [ ] **المقارنة الأساسية: Sonnet بالكيت مقابل Opus من غير كيت** على نفس الجلسات. دلوقتي Sonnet بالكيت 88% بـ $2.87، و Opus من غير كيت 95% بـ $5.76. يعني Sonnet بيقفل حوالي 70% من الفرق بنص التكلفة. الهدف إن Sonnet بالكيت يوصل ≥ 95% وتكلفته تفضل أقل من نص تكلفة Opus.
- [x] جلسة "ضخمة" واحدة على الأقل (12+ طلب، compaction 5 مرات) عشان نشوف الفرق لما الشغل يكبر.

## الترتيب
المراحل 1 و 2 و 3 الأول، لأنها بتصلّح الضرر الحالي مع Opus وهي رخيصة. بعدها المرحلة 4 على دفعات، كل دفعة حوالي 15 playbook وبعدها قياس صغير. المرحلة 5 في الآخر.

## اللي حصل (2026-11-27)
- **التشخيص:** Opus بالكيت عدّى h02 كاملة 8/8 في المرتين لما أعدنا التشغيل. يعني الخسارة الأولى كانت تذبذب بسبب إن الـ runs قليلة، مش عيب ثابت.
- **حوالي 20 playbook كانوا بيفرضوا قرارات معينة** (شكل الرد، الـ status codes، نوع الـ id، التقريب). بقوا defaults تتطبق بس لو المشروع ما حددش، وقاعدة الأولوية بقت أول حاجة في الـ injection.
- **الـ injection المختصر شغال:** مع Opus و Fable بيتحقن الـ Decision وجدول الـ edge cases بس.
- **الـ playbooks زادت من 48 لـ 122.** مراجعتين مستقلتين لقوا 75 غلطة حقيقية واتصلّحوا كلهم.
- **65 keyword عربي ما كانوش بيطابقوا أي طلب** لأنهم مش normalized، واتصلّحوا.
- **`.gitignore` كان بيتجاهل `Playbooks/security`**، واتصلّح.
- **الجلسات الجديدة:** x01 مرتبات، x02 عروض أسعار، x03 تذاكر (12 طلب و 5 compactions). اتبنت من غير ما اللي بناها يشوف الكيت، واتأكدت منها بنفسي.
- **القياس النهائي شغال:** 60 run، و4 إعدادات بـ 5 runs لكل واحد.
