# План восстановления Stripe: раздельные dev/prod окружения
_2026-05-29. Цель: каждое окружение = свой Stripe-режим, свой webhook-URL, своя БД. Без origin-роутинга и dual-secret внутри функции._

## Целевая архитектура

| | PROD | DEV |
|---|---|---|
| Supabase | `tizscxrpuopobgcxbekf` | `nydhzevdizkfaxdlikgc` |
| Stripe-режим | **live** | **test** |
| Webhook URL | `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook` | `https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/stripe-webhook` |
| Фронт (Vercel) | prod-деплой → live-ключи Supabase prod | preview/dev → ключи Supabase dev |

Один и тот же код функций в обоих проектах; поведение различается **только переменными окружения**. Никакого `STRIPE_TEST_ORIGIN`, никакого fallback live→test в вебхуке.

---

## Шаг 1. Переписать функции (убрать dual-env логику)

**`stripe-webhook`**
- Убрать `STRIPE_TEST_WEBHOOK_SECRET` + ветку fallback + флаг `isTestEvent`.
- Подпись проверять одним `STRIPE_WEBHOOK_SECRET`; клиент Stripe — один `STRIPE_SECRET_KEY`.

**`createStripeCheckout`, `createBillingPortal`, `getStripePrices`**
- Убрать `STRIPE_TEST_ORIGIN` и выбор test/live ключа. Оставить один `STRIPE_SECRET_KEY`.
- Origin-проверку оставить, но сверять только с `PUBLIC_APP_URL` (для dev там будет dev-URL).
- ID продуктов вынести в env (чтобы test/live определялись конфигом, а не хардкодом):
  `STRIPE_PRODUCT_PRO_TRIP`, `STRIPE_PRODUCT_PRO_MONTHLY`, `STRIPE_PRODUCT_PRO_YEARLY`.
  (Альтернатива попроще: один флаг `STRIPE_ENV=live|test`, выбирающий зашитую карту ID. Менее гибко, но быстрее.)

**Не трогаем:** `getUserPlan`, `checkSubscriptionStatus` — ключ Stripe не используют.

---

## Шаг 2. Переменные окружения (Supabase → Edge Functions secrets)

**PROD-проект:**
- `STRIPE_SECRET_KEY` = live `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` = подпись live-вебхука (из дашборда после шага 4)
- `STRIPE_PRODUCT_PRO_TRIP=prod_UYfZZsZnknkxDj`
- `STRIPE_PRODUCT_PRO_MONTHLY=prod_UYfZf8WvFNE3cI`
- `STRIPE_PRODUCT_PRO_YEARLY=prod_UYfZBYzOWrKiLu`
- `PUBLIC_APP_URL=https://triplanio.com` (или текущий prod-домен фронта)

**DEV-проект:**
- `STRIPE_SECRET_KEY` = test `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` = подпись test-вебхука
- `STRIPE_PRODUCT_PRO_TRIP=prod_UZnCx7GA3YlLJd`
- `STRIPE_PRODUCT_PRO_MONTHLY=prod_UZnBPOlJL0xmue`
- `STRIPE_PRODUCT_PRO_YEARLY=prod_UZnBUDGL1PuyEN`
- `PUBLIC_APP_URL=` URL dev/preview-фронта

После выноса ID удалить `STRIPE_TEST_*` секреты из обоих проектов.

---

## Шаг 3. Доставить недостающее

- Задеплоить `getStripePrices` в DEV-проект (сейчас отсутствует).
- Передеплоить переписанные функции в **оба** проекта (одинаковый код).

---

## Шаг 4. Stripe Dashboard (делает Pavel)

1. **Live-режим** → Developers → Webhooks → добавить endpoint:
   `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook`
   События: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Скопировать Signing secret → в `STRIPE_WEBHOOK_SECRET` PROD.
2. Переключить дашборд в **Test-режим** → добавить endpoint:
   `https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/stripe-webhook`
   Те же 3 события. Signing secret → в `STRIPE_WEBHOOK_SECRET` DEV.
3. Подтвердить, что test-продукты (`prod_UZnС…`, `prod_UZnB…`) существуют в test-режиме.
4. (Опц.) Выставить default_price для pro_trip и pro_yearly в live.
5. Старый base44-вебхук можно отключить (активных подписок нет — миграцию пропускаем).

---

## Шаг 5. Фронт (Vercel)

Убедиться, что dev/preview-деплой использует `VITE_SUPABASE_URL` + anon key **dev-проекта**, а prod — prod-проекта. Именно это разводит трафик `supabase.functions.invoke(...)` по нужному окружению (и, соответственно, по нужному Stripe-режиму).

---

## Шаг 6. Проверка

1. **DEV (test):** оплатить тест-картой `4242…`. Проверить: в dev-БД `stripe_events` +1, `trip_subscriptions` +1, `users.subscription_status='pro'`; UI на dev переключается на Pro.
2. Отмена через Billing Portal → прилетает `customer.subscription.deleted` → статус `free`.
3. **PROD (live):** разовая реальная покупка pro_trip ($5) для финальной проверки live-цепочки (потом рефанд).

---

## Чек-лист

- [ ] Переписать 4 функции (убрать dual-secret/origin, env-driven product IDs)
- [ ] Выставить секреты в PROD-проекте
- [ ] Выставить секреты в DEV-проекте
- [ ] Задеплоить getStripePrices в dev + передеплоить все 4 в оба проекта
- [ ] Live-webhook → prod URL (3 события) → secret в prod
- [ ] Test-webhook → dev URL (3 события) → secret в dev
- [ ] Проверить test-продукты в test-режиме
- [ ] Vercel: dev-фронт на dev-Supabase, prod-фронт на prod-Supabase
- [ ] Smoke-тест: dev (test-карта) → prod (live)
