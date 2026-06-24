---
name: triplanio-stripe-integration
description: "Состояние и целевая архитектура Stripe-интеграции Triplanio (dev/prod), webhook-URL, ключевые решения"
metadata: 
  node_type: memory
  type: project
  originSessionId: b3f57dcb-0e3d-4ac9-971d-65614dc54ab6
---

# Triplanio: Stripe-интеграция

_Аудит 2026-05-29. Отчёт: `triplanio_new/STRIPE_AUDIT_2026-05-29.md`, план: `triplanio_new/STRIPE_RECOVERY_PLAN_2026-05-29.md`._

## Состояние на 2026-05-29
- Функции (`createStripeCheckout`, `createBillingPortal`, `getStripePrices`, `getUserPlan`, `stripe-webhook`) перенесены base44→Supabase ~1:1, задеплоены ACTIVE в обоих проектах. Фронт целиком на `supabase.functions.invoke`. Схема БД совместима.
- **НЕ работает сквозно:** webhook в Stripe всё ещё указывает на base44. В новой БД `stripe_events=0`, `trip_subscriptions=0`. Активных подписок/покупок нет → миграцию данных пропускаем (решение Pavel).
- Идентификатор сменился: base44=`user_email`, новый=`user_id` (uuid). `trips.created_by`=uuid.
- `getStripePrices` НЕ задеплоена в dev-проекте (доставить).

## Два Supabase-проекта (= два окружения)
- PROD: `tizscxrpuopobgcxbekf` (eu-west-1) → Stripe **live**
- DEV: `nydhzevdizkfaxdlikgc` (eu-central-1) → Stripe **test**
- Webhook PROD: `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook`
- Webhook DEV: `https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/stripe-webhook`

## Реализованная архитектура (2026-05-29, СДЕЛАНО)
Один Stripe-режим на проект. 4 функции переписаны и задеплоены в ОБА проекта (идентичный код, одинаковый sha):
- `stripe-webhook` (dev v4 / prod v9, verify_jwt=false): один `STRIPE_WEBHOOK_SECRET`, без dual-secret fallback.
- `createStripeCheckout`, `createBillingPortal`, `getStripePrices`: убран `STRIPE_TEST_ORIGIN` и origin-роутинг.
- **Режим test/live определяется по префиксу `STRIPE_SECRET_KEY`** (`stripeKey.includes('_test_')`) — НЕ по env-флагу и НЕ по product-env-vars (это была идея в плане, заменена на детект по ключу). Product IDs остались зашиты (LIVE_PRODUCTS/TEST_PRODUCTS).
- `getStripePrices` доставлена в dev (раньше отсутствовала).
- Origin-проверка теперь только против `PUBLIC_APP_URL`.
- Файл плана `triplanio_new/STRIPE_RECOVERY_PLAN_2026-05-29.md` частично устарел (там product-env-vars) — фактически реализован детект по ключу.

## Env-переменные (на проект)
- `STRIPE_SECRET_KEY` — **КРИТИЧНО:** prod = `sk_live_…`, dev = `sk_test_…`. От префикса зависит выбор продуктов и режима. Если в dev положить live-ключ → реальные платежи!
- `STRIPE_WEBHOOK_SECRET` — Pavel прописал (live в prod, test в dev).
- `PUBLIC_APP_URL` — Stripe (checkout/portal) + письма (`inviteTripMember`, `resendTripInvite`); per-project. prod=`https://www.triplanio.com`, dev=ждёт стабильного dev-URL.
- БОЛЬШЕ НЕ НУЖНЫ (можно удалить): `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_ORIGIN`.

## Остаток (ручное, на Pavel)
1. Проверить `STRIPE_SECRET_KEY`: prod=live, dev=test.
2. Стабильный dev-URL (`dev.triplanio.com` или git-branch URL) → `PUBLIC_APP_URL` dev + Auth redirect allowlist (чинит вылет после логина на preview).
3. Vercel: dev-фронт → dev-Supabase (VITE_SUPABASE_URL), prod → prod.
4. Smoke-тест: dev (test-карта 4242) → prod (live).

## Stripe-аккаунт (acct_1TZbo54gdjGHpLmX «Triplanio»)
- Live-продукты: pro_trip `prod_UYfZZsZnknkxDj` ($5 one-time, default_price=null→фолбэк), pro_monthly `prod_UYfZf8WvFNE3cI` (default есть), pro_yearly `prod_UYfZBYzOWrKiLu` ($48/год, default_price=null→фолбэк).
- Test-продукты (в коде): `prod_UZnCx7GA3YlLJd` / `prod_UZnBPOlJL0xmue` / `prod_UZnBUDGL1PuyEN` — проверить, что существуют в test-режиме.
