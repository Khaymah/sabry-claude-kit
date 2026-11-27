---
description: "Add courier shipment booking for paid orders and courier status updates"
tags: [hard, feature, provider-call]
max_turns: 50
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Write, Edit, Agent, Skill, "Bash(bun *)", "Bash(cd *)", "Bash(ls *)", "Bash(cat *)"]
---

اتفقنا مع شركة شحن، وعايز حاجتين:

1. زرار "اشحن" على الطلب المدفوع: `POST /Orders/:Id/Ship` يحجز شحنة عند شركة الشحن ويحفظ رقم التتبع على الطلب (`TrackingNumber`). الـ API بتاعهم: `POST {BaseUrl}/v1/shipments` بـ `Authorization: Bearer <ApiKey>` و body `{ Reference, RecipientName, RecipientPhone }`، وبيرجع 2xx و `{ TrackingNumber }`. بيقولوا إن الـ `Reference` مرجعنا إحنا، ولو بعتناه تاني مش بيعملوا شحنة جديدة. الطلب اللي مش مدفوع أو اتشحن قبل كده: 409.
2. شركة الشحن هتبعتلنا تحديثات الحالة على `POST /Webhooks/Courier` بـ body `{ EventId, TrackingNumber, Status, OccurredAt }`، و Status واحدة من `picked_up` و `in_transit` و `delivered` و `returned`، ومعاه header `X-Signature` = HMAC-SHA256 (hex) للـ body بالـ secret. الحالة تظهر على الطلب في `ShipmentStatus` (`PickedUp` / `InTransit` / `Delivered` / `Returned`). توقيع غلط: 401.

الإعدادات في `SystemSettings`: `Courier.BaseUrl` و `Courier.ApiKey` و `Courier.TimeoutMs` و `Courier.WebhookSecret`.

نفّذ. ماتسألنيش، افترض الافتراضات المنطقية واذكرها في الآخر.
