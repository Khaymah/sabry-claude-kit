# ADR-0033 — نشر واجهة Next.js كـ standalone artifact على فرع `build`

- **الحالة:** مقبول
- **التاريخ:** 2026-10-12
- **Deciders:** Sabry
- **يعدّل:** جزء نشر الواجهة في [ADR-0016](0016-nginx-pm2-on-the-host.md): الـ API مستقل عن عملية الواجهة، لذلك الواجهة لا تتصل به عبر loopback.
- **السياق:** [Plan/Client-CI-Standalone-Deploy.md](../Plan/Client-CI-Standalone-Deploy.md)
- **يمسّ:** `Client/.github/workflows/ci.yml` · `Client/next.config.ts` · `Client/ecosystem.config.cjs`

## القرار

1. يبني CI تطبيق Client بـ `output: "standalone"`، ويشغّل typecheck والاختبارات والبناء قبل النشر.
2. عند نجاح push إلى `main` فقط، ينشر CI محتويات standalone على فرع `build` في مستودع Client. الفرع يحتوي `server.js` وملفات التشغيل الدنيا، و`.next/static` و`public` و`ecosystem.config.cjs`؛ لا يحتوي كود Server ولا يعتمد على تثبيت Bun في خادم الواجهة.
3. فرع `build` هو artifact قابل للتشغيل، وليس نشرًا تلقائيًا إلى VPS. يجلبه مسؤول الخادم ويشغّله أو يحدّثه عبر PM2.
4. يشغّل PM2 ملف `server.js` بـ Node، على `127.0.0.1:6001`. يوجّه Nginx طلبات الواجهة إلى هذا المنفذ.
5. واجهة Next والـ API خدمتان مستقلتان. المتصفح يستخدم `NEXT_PUBLIC_API_BASE_URL` المضمّن وقت البناء، وSSR يستخدم `API_INTERNAL_BASE_URL` وقت التشغيل. كلاهما يشير إلى عنوان الـ API القابل للوصول من الواجهة؛ لا يُستخدم `127.0.0.1` للـ API.
6. يُبنى artifact على Linux في GitHub Actions ويُشغّل على خادم Linux متوافق، مع Node.js وPM2. لا توضع أسرار في فرع `build`.

## العواقب

- يفشل النشر قبل تحديث `build` إذا فشل typecheck أو الاختبار أو البناء.
- يعيد CI كتابة فرع `build` بالقوة ليحتوي أحدث artifact فقط؛ لا تُجرى تعديلات يدوية عليه.
- يلزم جلب الفرع وإعادة تشغيل PM2 يدويًا؛ CI لا يملك SSH ولا ينفّذ نشرًا على VPS.
- تغيير عناوين `NEXT_PUBLIC_*` يتطلب إعادة البناء، أما `API_INTERNAL_BASE_URL` فيُحدّث عند تشغيل PM2.
