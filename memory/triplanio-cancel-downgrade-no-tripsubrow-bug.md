---
name: triplanio-cancel-downgrade-no-tripsubrow-bug
description: "БАГ stripe-webhook — отмена подписки не понижает users.subscription_status, если нет строки в trip_subscriptions (единственный мост Stripe→user)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 43453647-e195-4807-858d-dadc8048e6b2
---

★ДИАГНОЗ 2026-06-07 (dev). Симптом: avel123111.dev@gmail.com (user c84e0d81-af3c-423c-b328-4fab11ad727b) отменил подписку, в аккаунте всё ещё Pro.

Факты dev (nydhzevdizkfaxdlikgc):
- users.subscription_status='pro', end 2027-06-01 — не сброшен.
- stripe_events: события customer.subscription.updated (13:39) и .deleted (13:40) сегодня ПОЛУЧЕНЫ, подпись прошла, записаны как processed. Доставка вебхуков работает.
- trip_subscriptions: в таблице всего 2 строки, обе у 2c36dddc (avel123111@gmail.com). У c84e0d81 строки НЕТ.

ROOT CAUSE: в stripe-webhook обработчики `customer.subscription.deleted` и `customer.subscription.updated` резолвят юзера ТОЛЬКО через `trip_subscriptions.stripe_subscription_id = subscription.id`. Нет совпадающей строки → весь блок понижения под `if (subRows.length>0)` пропускается → users не трогается. Событие всё равно пишется в stripe_events как обработанное → Stripe не ретраит, ошибка проглатывается молча.

Архитектурный изъян: единственный мост Stripe→Supabase-юзер = trip_subscriptions.stripe_subscription_id. На users НЕТ stripe_customer_id/stripe_subscription_id. Любой дрейф (ресет/клон dev чистит trip_subscriptions, но не users) ломает отмену. Тот же код в PROD (live) → тот же риск.

ФИКС (предложен, НЕ применён):
1. Данные dev: c84e0d81 → subscription_status='free'.
2. Системно: users.stripe_customer_id (+ subscription_id), заполнять в checkout.session.completed; в deleted/updated резолвить юзера через customer→users (fallback при отсутствии trip_subscriptions). Не помечать событие processed, если для известного типа не найден ожидаемый таргет — логировать/алертить. Накатить на prod+dev.
3. Проверить createBillingPortal — как он находит customer id (зависимость).

См. [[triplanio-stripe-integration]] [[triplanio-pro-model]] [[triplanio-entitlement-reconciliation-todo]] [[triplanio-pro-audit]]
