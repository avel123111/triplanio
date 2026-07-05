---
name: triplanio-payments-audit-2026-06-29
description: Полный аудит платёжной архитектуры TRIP-32 (2026-06-29) — выводы, открытые вопросы, бэклог упрощений
metadata:
  type: project
---

★АУДИТ 2026-06-29 (по запросу Pavel в TRIP-32): полный разбор платёжной/энтайтлмент-архитектуры на свежем dev. Ядро признано чистым и солидным после переписывания 2026-06-28 (purchase/subscription реестр + webhook_event + StripeAdapter + recompute/revoke). Двойная оплата закрыта нативной идемпотентностью Stripe. typecheck+тесты зелёные.

**Notion обновлён:** страница «Stripe — поток оплаты и жизненный цикл (источник истины)» (id 3862c9f1-427e-812a-a4bb-cd21287ca127) ПОЛНОСТЬЮ переписана под текущую модель (старые 131 блок про trip_subscriptions/stripe_events/random-idem заархивированы, 85 новых блоков человеческим языком).

**Открытые вопросы (ждут решения Pavel, код НЕ менялся):**
- `planTripWithAi` гейтится ТОЛЬКО rate-limit (10/час/юзер), без Pro-проверки — в отличие от `callTriplanioAi`/`parseBookingWithAi` (там is_trip_pro). Вопрос: AI-планировщик = бесплатная воронка или Pro-фича? Это продуктовое решение, не баг.
- ~~Для разовых Trip Pro НЕТ reconcile-on-read~~ **УСТАРЕЛО (сверено 2026-07-05, TRIP-61):** reconcile-on-read для pro_trip ЕСТЬ — `reconcileTripEntitlement` (`_shared/reconcileEntitlement.ts`), зовётся из `checkSubscriptionStatus` при `tripIsPro`; ходит в Stripe по purchase.provider_charge_id (=payment_intent), на полном рефанде/диспуте ставит refunded/disputed + `recompute_trip_entitlement` + `revokeLostProFeaturesForTrip` (троттл 10 мин на purchase.synced_at). Потерянный refund-вебхук по pro_trip чинится при следующем открытии трипа. Асимметрии подписка↔pro_trip больше нет.

**Бэклог упрощений (безрисковые, в hygiene-PR, поведение не меняют):** дедуп `ENTITLING=['active','trialing','past_due']` (4 файла) → экспорт из catalog.ts; хелпер `billingIntervalForProduct` (тернарник ×6 в webhook+reconcile); `isStaleEvent` ordering-guard (дубль в subscription.updated/deleted); `checkSubscriptionStatus` использует свой createClient+getUser вместо общих supabaseAdmin/getRequestUser; `reconcileEntitlement`+`getUserPlan` создают `new Stripe(key)` в обход StripeAdapter; крупное — единый `buildSubRow` для 5 upsert-веток подписки (рискованнее из-за nullable provider_meta).

**Мёртвые/неиспользуемые поля схемы (не баг):** purchase.raw, subscription.raw, subscription.current_period_start, collection_state='grace', webhook_event.redelivery_count/attempts, provider_price.provider_price_id. Мост plan_type↔product_code — переходный (уйдёт в Ф5).

Связки: [[triplanio-payments-foundation-rebuild]] [[triplanio-payments-phase-status]] [[triplanio-payments-deep-audit]]
