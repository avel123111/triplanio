---
name: triplanio-dev-parallel-env
description: Параллельное dev-окружение Triplanio (dev-Supabase + sandbox-Stripe) и скрипт клонирования трипов prod→dev
metadata: 
  node_type: memory
  type: project
  originSessionId: 0a4a117a-f457-4336-9b4d-6993a2dee83f
---

Цель (согласовано 2026-05-31): ветка `dev` работает полностью на dev-инфраструктуре — dev-Supabase `nydhzevdizkfaxdlikgc` + Stripe sandbox (test-режим), параллельно `main`/prod (`tizscxrpuopobgcxbekf` + Stripe live). n8n и Telegram остаются ОБЩИМИ (prod) — это осознанно ок для тестов. Связано: [[triplanio-stripe-integration]], [[triplanio-deploy-verify-jwt]], [[triplanio-status]].

Переключение окружения уже заложено в коде: фронт читает VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, функции зовутся через supabase.functions.invoke() (база выводится из VITE_SUPABASE_URL). Хардкодов prod-URL в src/ нет. Vercel: один проект triplanio, переменные Preview-scope на ветку dev → dev.triplanio.com (всё уже настроено Pavel: env, домен, redirect URLs, Google OAuth).

СТАТУС 2026-05-31: edge-функции выровнены через Supabase MCP deploy_edge_function на dev nydhzevdizkfaxdlikgc — getPublicTrip (verify_jwt=false, v3), getMapsApiKey, telegramGetBotInfo, telegramGetWebhookInfo, sendTripReminders (все verify_jwt=true, ACTIVE). sendTripReminders в репо ОТСУТСТВУЕТ — код взят с prod (std@0.168 serve + esm.sh supabase-js, заглушка: просто считает трипы, реальной рассылки нет). Stripe dev: Pavel создал НОВЫЕ секреты STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET с test-значениями (канон. имена) — старые STRIPE_TEST_* остались, игнорируются. ОСТАЛОСЬ Pavel: git add/commit/push scripts/clone-trip.mjs; создать .env с service-role ключами для клона; (опц.) удалить STRIPE_TEST_*.

Что было НЕ выровнено на dev (исходно, на 2026-05-31 — теперь исправлено deploy'ем выше):
- getPublicTrip на dev стоял verify_jwt=true (на prod false) — ломает share-ссылки. Фикс: deploy --no-verify-jwt.
- На dev ОТСУТСТВОВАЛИ 4 функции, что есть на prod: getMapsApiKey (критично — карта), sendTripReminders (крон), telegramGetBotInfo, telegramGetWebhookInfo (админ-диагностика). Решено деплоить все 4.
- Stripe на dev: Pavel задал STRIPE_TEST_SECRET_KEY / STRIPE_TEST_WEBHOOK_SECRET, НО код читает строго STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (без _TEST_, без фолбэка) в 6 функциях: createStripeCheckout, createBillingPortal, getStripePrices, getUserPlan, changeSubscriptionPlan, stripe-webhook. Решение (модель «один режим Stripe на проект»): на dev задать секреты с КАНОНИЧНЫМИ именами STRIPE_SECRET_KEY=sk_test_…, STRIPE_WEBHOOK_SECRET=whsec(test)…; STRIPE_TEST_* удалить. Код не править.
- Дрейф схемы: prod 26 таблиц, dev 23 (нет testTable, n8n_chat_histories, n8n_chat_messages). Оставлено осознанно — n8n общий, пишет в prod.

⚠️ Безопасность (отдельный долг, не часть этой задачи): на PROD таблица public.n8n_chat_histories с ВЫКЛЮЧЕННЫМ RLS — читается/пишется любым с anon-ключом. Включать RLS только с политикой (иначе сломает n8n).

Клонирование трипов prod→dev: скрипт scripts/clone-trip.mjs в репо triplanio_new.
- Запуск: `node scripts/clone-trip.mjs <PROD_TRIP_ID> [DEV_USER_ID]`. DEV_USER_ID по умолчанию = 2c36dddc-d2a5-4cad-882b-c397503a8fba (тестовый dev-юзер Pavel).
- Нужен .env (в .gitignore) с PROD_SERVICE_ROLE_KEY и DEV_SERVICE_ROLE_KEY.
- Стратегия: ремап всех владельцев (created_by/user_id/invited_by) на одного dev-юзера, auth.users НЕ трогается. Новые UUID + ремап ссылок (city_visit_id, category_id, source_id, chat_id).
- Клонирует: trips, city_visits, hotel_stays, activities, transfers, trip_budgets, budget_categories, budget_expenses, trip_services, trip_documents, chats, chat_messages, chat_reads, trip_members.
- НЕ клонирует: trip_subscriptions, stripe_events, notifications, partner_clicks, telegram_*, n8n_*.
- Caveat: chat_messages бота тоже ремапятся на dev-юзера (теряется различение бота); приемлемо для тестов.
