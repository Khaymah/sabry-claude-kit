# قرارات معمارية

عند قرار معماري/تقني جوهري (stack، schema، API contract، integration، auth، pricing model):

1. اقرأ [Quality-Gate.md](../Quality-Gate.md) — الثمانية محاور بعمق
2. عالج الـ 2–4 محاور الـ load-bearing فعلاً، وأسقط الباقي **بسبب سطر واحد**
3. عند التعارض ← صرّح بالـ trade-off ("نضحّي بـ X لصالح Y لأن...")
4. سجّل ADR في `Decisions/Global/` أو `Decisions/<Project>/` (ترقيم تلقائي) وأبلغني بسطر

**ليس ADR-worthy:** code style، مواضع helper functions، أي شيء قابل للتراجع بسهولة.

**تحذير:** فرض الثمانية على قرار تافه = over-engineering. الهدف وعي، لا طقوس.
