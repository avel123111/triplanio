# Аудит интеграции Stripe: base44 → Triplanio (Supabase)
_Дата: 2026-05-29. Проверено по коду обоих репо + коннекторы Stripe (acct_1TZbo54gdjGHpLmX «Triplanio») и Supabase (`tizscxrpuopobgcxbekf`)._

## Вердикт за 10 секунд

Код перенесён практически 1:1 и **полностью задеплоен**, фронт зовёт Supabase-функции, схема БД совместима. Но сквозной платёжный поток **сейчас не работает** по одной причине: **webhook в Stripe всё ещё указывает на base44** (ты это подтвердил). Поэтому оплата на новом приложении создаст Checkout-сессию, но событие об оплате уйдёт в base44, а не в Supabase — `users`/`trip_subscriptions` в новой БД не обновятся, и UI никогда не переключит юзера на Pro.

Доказательство из БД: `stripe_events = 0`, `trip_subscriptions = 0` — в новый webhook ещё ни разу не пришло ни одного события. (`pro_users = 1` — это вручную/сидом проставленный статус, не через Stripe.)

Грубо: **код готов на ~95%, конфигурация (webhook + секреты) — на 0%.**

---

## 1. Что перенесено и в каком состоянии

| Функция | base44 | Supabase (репо) | Задеплоено | verify_jwt | Статус |
|---|---|---|---|---|---|
| `createStripeCheckout` | ✅ | ✅ | ✅ ACTIVE v6 | true | 🟢 1:1 миграция |
| `createBillingPortal` | ✅ | ✅ | ✅ ACTIVE v6 | true | 🟢 1:1 |
| `getStripePrices` | ✅ | ✅ | ✅ ACTIVE **v4 (старее)** | true | 🟡 задеплоена более ранняя ревизия |
| `getUserPlan` | ✅ | ✅ | ✅ ACTIVE v6 | true | 🟢 1:1 |
| `stripe-webhook` | ✅ | ✅ | ✅ ACTIVE v6 | **false** ✅ | 🟢 1:1 |
| `createTestCheckout` | ✅ | ❌ (только в `new/base44/`) | ❌ не задеплоена | — | ⚪️ admin-тест, не критично |

Фронт (`UpgradePlanDialog.jsx`, `pages/Pro.jsx`, `redesign/ScreenAccount.jsx`) уже целиком на `supabase.functions.invoke(...)`. base44-вызовов в платёжном UI не осталось.

Сохранены все защитные механизмы оригинала: идемпотентность по `stripe_events` + по `stripe_checkout_id`, проверка владельца трипа для `pro_trip`, блок дублей активной подписки, race-guard «недавний checkout в полёте», поддержка `current_period_end` для нового Stripe API.

---

## 2. Главное архитектурное изменение: `user_email` → `user_id` (UUID)

base44 идентифицировал всё по email. Новая версия — по `user_id` (UUID Supabase Auth).

- В metadata Checkout теперь кладётся `user_id` (и `user_email` для справки).
- Webhook читает `user_id` из metadata, обновляет `users` по `id`, пишет `trip_subscriptions.user_id`.
- `trips.created_by` в схеме = `uuid`, поэтому проверка `trip.created_by !== user.id` в `pro_trip` корректна.

**Последствие для миграции (важно на этапе переключения):**

1. Старые сессии, созданные на base44, несут в metadata `user_email`, а не `user_id`. Если такое «дохвостовое» событие прилетит в новый webhook — `user_id` будет `undefined`, апдейт юзера не пройдёт, строка подписки запишется с `user_id = null`. Пока webhook на base44 — это не происходит, но это риск в момент cutover.
2. Активные **рекуррентные** подписки, оформленные на base44, при продлении/отмене шлют `customer.subscription.updated/deleted`. Новый webhook ищет строку по `stripe_subscription_id` в `trip_subscriptions` Supabase — но этих строк там нет (данные не мигрированы). Значит для уже существующих подписчиков продления/отмены будут **молча игнорироваться**. Нужно мигрировать активные подписки в `trip_subscriptions` до переключения webhook.

---

## 3. Совместимость схемы Supabase — ✅ полная

- `users`: `subscription_status` (text), `subscription_end_date` (timestamptz) — есть.
- `trip_subscriptions`: `user_id`, `trip_id`, `type`, `status`, `stripe_subscription_id`, `stripe_checkout_id`, `stripe_payment_intent_id`, `start_date`, `end_date`, `amount_paid`, `currency` — всё есть (плюс `created_by uuid`).
- `stripe_events`: `event_id`, `type`, `processed_at` — есть.
- `notifications`: `user_id` (uuid) — есть, webhook пишет туда «Pro activated».

Никаких недостающих колонок. Код и схема согласованы.

---

## 4. Stripe-аккаунт и продукты (LIVE)

Коннектор подключён в **live**-режиме. Продукты из кода найдены:

| План | Product ID (live) | default_price | Активная цена |
|---|---|---|---|
| pro_trip | `prod_UYfZZsZnknkxDj` | ⚠️ **null** | $5.00 one-time (`price_1TaLR9...`) |
| pro_monthly | `prod_UYfZf8WvFNE3cI` | ✅ задан | (default) |
| pro_yearly | `prod_UYfZBYzOWrKiLu` | ⚠️ **null** | $48.00/год (`price_1TaLR6...`) |

- У `pro_trip` и `pro_yearly` в live **не выставлен default_price** → код опирается на фолбэк «первая активная цена». Сейчас работает (по одной активной цене), но хрупко: добавишь вторую активную цену — фолбэк выберет произвольную. Рекомендую проставить default price в дашборде.
- TEST-продукты (`prod_UZnCx7GA3YlLJd`, `prod_UZnBPOlJL0xmue`, `prod_UZnBUDGL1PuyEN`) проверить не смог — коннектор в live-режиме. **Нужно подтвердить, что они существуют в test-mode.**
- `prod_UZ9Yn841dRm7v0` («Test subscription») — это live-продукт, используется только `createTestCheckout` (не задеплоена). Не путать с test-mode продуктами.

---

## 5. Что блокирует работу (по приоритету)

### 🔴 P0 — Webhook в Stripe указывает на base44
Без этого оплата на новом приложении не доходит до Supabase. Нужно в Stripe Dashboard:
- Добавить endpoint `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook`
- События: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Сделать это в **обоих** режимах — live и test (см. раздел 6).
- На время параллельной работы можно держать **оба** endpoint'а (base44 + Supabase) одновременно, пока трафик не переключён.

### 🔴 P0 — Секреты в Supabase (проверить, что заданы)
Из логов подтвердить не удалось (за 24ч не было вызовов Stripe-функций). Обязательны:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `PUBLIC_APP_URL`, `STRIPE_TEST_ORIGIN`.
Если хоть один live-ключ отсутствует → checkout/prices вернут 500 «Stripe key missing».

### 🟡 P1 — Миграция активных подписок
Перенести строки активных рекуррентных подписок base44 → `trip_subscriptions` (с правильным `stripe_subscription_id` и `user_id`), иначе продления/отмены существующих подписчиков потеряются (см. раздел 2).

### 🟡 P2 — Переразложить `getStripePrices`
Задеплоена ревизия v4 (старее остальных v6). Передеплоить из репо, чтобы исходник совпадал.

### 🟢 P3 — Выставить default_price для pro_trip и pro_yearly в live.

---

## 6. Параллельная поддержка dev + prod (2 интеграции)

Хорошая новость: dual-env уже встроен в перенесённый код.

**Webhook (один URL на оба режима):** пробует сначала live-секрет, при неудаче — test-секрет; по `event.livemode` выбирает `STRIPE_SECRET_KEY` либо `STRIPE_TEST_SECRET_KEY` для последующих вызовов. Значит **один** Supabase-endpoint обслуживает и live, и test события. (В Stripe Dashboard всё равно нужно зарегистрировать endpoint в обоих режимах — секреты подписи разные.)

**Checkout / Portal / Prices (маршрутизация по origin запроса):** если `Origin` запроса === `STRIPE_TEST_ORIGIN` → test-ключи + test-продукты; иначе → live. (base44 хардкодил test-origin, новая версия читает из env — чище.)

Рекомендуемая схема:
- **prod** (`triplanio.com`) → live-ключи + live-продукты.
- **dev/preview** → выставить `STRIPE_TEST_ORIGIN` на нужный origin → test-ключи + test-продукты.

**Ограничения, которые стоит учесть под твою цель «2 интеграции»:**
1. `STRIPE_TEST_ORIGIN` — **один** origin. Vercel preview-деплои имеют динамические URL → под фиксированный origin не подойдут. Если хочешь тестить с нескольких origin (localhost + preview), нужно доработать функции на список/regex origin'ов, а не одну строку.
2. **Общая БД.** Сейчас dev и prod пишут в одну и ту же Supabase (`users`, `trip_subscriptions`, `stripe_events`). Test-оплаты будут смешиваться с реальными в проде. Для настоящей изоляции dev лучше отдельный Supabase-проект (или branch) + свой webhook-endpoint + свои секреты. Это более чистая «вторая интеграция», чем origin-роутинг внутри одного проекта.

---

## 7. Чек-лист запуска Stripe на новом приложении

- [ ] Задать/проверить 6 секретов в Supabase (live + test).
- [ ] Зарегистрировать webhook на Supabase-URL в Stripe **live** (3 события) → записать `STRIPE_WEBHOOK_SECRET`.
- [ ] Зарегистрировать webhook на Supabase-URL в Stripe **test** (3 события) → записать `STRIPE_TEST_WEBHOOK_SECRET`.
- [ ] Выставить `STRIPE_TEST_ORIGIN` = origin dev-окружения.
- [ ] Подтвердить существование 3 test-продуктов в test-mode.
- [ ] Передеплоить `getStripePrices` из репо (синхронизация ревизии).
- [ ] Мигрировать активные рекуррентные подписки base44 → `trip_subscriptions`.
- [ ] Тест в test-mode: оплата → `stripe_events` растёт, `users.subscription_status='pro'`, UI flips.
- [ ] (Опц.) Проставить default_price для pro_trip и pro_yearly в live.
- [ ] Решить вопрос изоляции dev/prod БД (общая vs отдельный Supabase-проект).
