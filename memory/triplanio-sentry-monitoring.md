---
name: triplanio-sentry-monitoring
description: "Подключение Sentry (мониторинг ошибок) — один EU-проект, env-тег, статус фронт/edge, переменные"
metadata: 
  node_type: memory
  type: project
  originSessionId: e6987ecc-f3d0-4a4b-82ac-7a8ee32bd056
---

Sentry для Triplanio. Орг **triplanio** на **EU-регионе** (`triplanio.sentry.io`, ingest/api `de.sentry.io`), free-план, один проект `triplanio`. Окружения разделяются **тегом `environment`** (production/development), не отдельными проектами. DSN: `https://9c578daf4586c7383f902d365a22b983@o4511457186283520.ingest.de.sentry.io/4511498293870672` (публичный, едет в бандл как Mapbox-токен).

Решения сессии 2026-06-03: подключаем **сейчас** (фаза активной разработки = максимум багов), но алерты глушим на `environment=development`, чтобы dev-churn не жёг общую free-квоту. Старт **errors-only** (`tracesSampleRate:0`, без replay). Edge n8n-пайплайны Pavel из периметра Sentry исключил (совет: включить n8n error-trigger).

**Ф1 ФРОНТ — СДЕЛАНО (в коде, ветка dev, ждёт push+deploy):**
- `@sentry/react@10.56` + `@sentry/vite-plugin@5.3` установлены.
- `src/lib/sentry.js` — `initSentry()`: no-op без DSN; `sendDefaultPii:false`; `beforeSend` срезает cookies/data/auth-headers/query-string, оставляет только `user.id`; `ignoreErrors` (ResizeObserver, Failed to fetch, AbortError и т.п.).
- `src/main.jsx` — `initSentry()` до рендера.
- `src/components/AppErrorBoundary.jsx` — переиспользован существующий ErrorBoundary, добавлен `Sentry.captureException` в `componentDidCatch` (не дублировали Sentry.ErrorBoundary).
- `vite.config.js` — `sentryVitePlugin` активен **только при `SENTRY_AUTH_TOKEN`** (= Vercel CI); `url:'https://de.sentry.io'` (EU обязателен, иначе sourcemap-аплоад молча падает); `build.sourcemap:'hidden'` + `filesToDeleteAfterUpload` (мапы не деплоятся); release из `VERCEL_GIT_COMMIT_SHA` через `define __SENTRY_RELEASE__`.
- Билд проверен: подстановка release ок, SDK в бандле, без токена .map не создаются.

**Переменные.** Vercel (Production+Preview): `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT` (production в Prod-скоупе / development в Preview), `SENTRY_AUTH_TOKEN`(секрет), `SENTRY_ORG=triplanio`, `SENTRY_PROJECT=triplanio`, `SENTRY_URL=https://de.sentry.io`. Supabase secrets на ОБА проекта: `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (production на prod / development на dev). `SENTRY_AUTH_TOKEN` создаётся вручную (Settings→Auth Tokens, scope project:releases) — через MCP-коннектор не выдаётся.

**Ф4 EDGE — КОД СДЕЛАН, ЖДЁТ ДЕПЛОЯ.** `_shared/sentry.ts`: `npm:@sentry/deno@10.56.0`, `defaultIntegrations:false` (Deno SDK НЕ изолирует scope между запросами в переиспользуемом изоляте → контекст/PII протекли бы; контекст передаём напрямую в captureException, не в глобальный scope), `tracesSampleRate:0`, `sendDefaultPii:false`, `beforeSend` срезает `event.user` (edge ingestion пишет IP/geo вызывающего), тег `surface:edge` (НЕ `runtime` — зарезервирован SDK). Экспорт `captureEdgeError(error, fn, extra)` = captureException + `await flush(2000)`, no-op без DSN, не бросает.
Интегрировано в catch-блоки 14 функций (скриптом, врезка перед console.error/500): stripe-webhook, createStripeCheckout, changeSubscriptionPlan, checkSubscriptionStatus, createBillingPortal, getUserPlan, getStripePrices, getTripDetails, getTripById, getPublicTrip, parseBookingWithAi, planTripWithAi, triplanioAiReply, telegramWebhook.
ВАЛИДАЦИЯ на dev пройдена: одноразовая `sentry-edge-test` (verify_jwt=false) задеплоена на dev-проект, дёрнута → событие TRIPLANIO-2 дошло, `environment=development`, импорт @sentry/deno в рантайме Supabase работает, `SENTRY_DSN` на dev задан. ВНУТРЕННИЙ TODO: удалить `sentry-edge-test` (репо-папка + функция на dev).
verify_jwt задан в `supabase/config.toml` (stripe-webhook/telegramWebhook/getPublicTrip/getTripById/triplanioAiReply=false) → CLI-деплой применяет сам. Деплой: цикл `supabase functions deploy <fn> --project-ref <ref>` сначала dev (nydhzevdizkfaxdlikgc), потом prod (tizscxrpuopobgcxbekf). См. [[triplanio-deploy-verify-jwt]], [[triplanio-deploy-topology]].
Прод-проект Supabase ref=tizscxrpuopobgcxbekf, dev ref=nydhzevdizkfaxdlikgc (оба EU).
Тестовые issue: TRIPLANIO-1 (фронт prod), TRIPLANIO-2 (edge dev) — можно зарезолвить.

**Ф6 — Notion-док (раздел Monitoring/Sentry) ещё не создан.**

Грабли окружения: песочница на mount'е не может удалять файлы (EPERM на unlink) — остались `dist_sentry_check/` и стейл `.git/index.lock`, чистить руками на машине Pavel перед коммитом.
