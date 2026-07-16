---
name: triplanio-sentry-coverage-plan
description: TRIP-219 — согласованный план расширения охвата Sentry + решения Pavel по 4xx/cron/трейсингу
metadata:
  type: project
---

★ПЛАН+РЕШЕНИЯ 2026-07-16 (TRIP-219, Pavel). Аудит: Sentry сейчас = тонкий
errors-only слой, покрыто 2 из ~6 контуров, edge 15/45 функций,
`tracesSampleRate:0`, replay/profiling нет. Source-maps работают,
`reportPaymentAnomaly`-алерты и PII-скраб есть. На 16.07 в Sentry было 10
открытых issue — все закрыты (resolved): платёжные 6/7 (уже пофикшены в dev+main
рефактором TRIP-32: invoice.paid→upsert onConflict, idemKey+custId), E
(uuid→classifyDbError TRIP-208), C (setConfirmDel→removeCity, dev+main), D
(reconcile-сигнал, не баг), 2 (throttle геокодера), A (teardown карты), 4/5 (шум
Sentry feedback-виджета), B (chunk preload — ЕДИНСТВЕННАЯ ещё стреляет, ре-опенится
при деплое пока нет `vite:preloadError`→reload).

**Решения Pavel по мониторингу (применять при реализации фаз):**
1. **Edge-обёртка** `withHandler(fnName, handler)` в `_shared/http.ts` (cors+OPTIONS+
   try/catch+capture) + CI-гард «функция без обёртки не проходит PR». Покрыть 30
   непокрытых. ★Pavel: шлём в Sentry ЛЮБОЕ неожиданное — **4xx (вкл. 400), 5xx,
   таймауты**, всё как ошибки. **Про квоту не думаем.** ИСКЛЮЧИТЬ из обёртки
   спец-функции (свои контракты, уже ловят точечно): `stripe-webhook`,
   `telegramWebhook`, `render-share-card` (не-JSON), rate-limited
   `signupPrecheck`/`requestPasswordReset`. Раскатывать траншами, пилот на одной.
2. **Фронт** — capture проглоченных ошибок в центральном edge-invoke слое (`src/lib`)
   + route/feature error-boundaries вместо единственного `AppErrorBoundary`.
3. **Точка 5 (согласована ВКЛючить, квоту игнорируем):** `tracesSampleRate` +
   `tracePropagationTargets` (единый трейс browser→edge→DB) + **Session Replay**.
4. **Cron-монитор** на `getPendingReminders` (Sentry Cron Monitor / check-in из
   15-мин n8n Schedule Trigger — ловит «крон вообще не отработал») — ★делать В КОНЦЕ
   вместе с остальным n8n (n8n глобальный Error Workflow → Sentry).
5. `getDailyReminders` — ВЫПИЛЕН в TRIP-219 (мёртвый daily-digest, ни один n8n не
   звал); см. [[triplanio-deploy-verify-jwt]] (pinned-false 12→11).

Порядок: edge-обёртка+гард → фронт → точка5(трейсинг+replay) → n8n(Error Workflow
+ cron-монитор getPendingReminders) в конце.

**★ПРОГРЕСС (Edge-фаза ЗАВЕРШЕНА, 2026-07-16):** `withHandler` в `_shared/http.ts`
(cors+OPTIONS+catch, репорт 4xx/5xx, фон через `EdgeRuntime.waitUntil`=0 латентности,
+`console.error` на 5xx для Supabase logs). Все **44** edge-функции покрыты: 26 на
`withHandler`, 5 с маркером `// sentry: manual` (stripe-webhook/telegramWebhook/
render-share-card/signupPrecheck/requestPasswordReset), 13 держат инлайн
`captureEdgeError` (aiGate/checkSubscriptionStatus/createBillingPortal/
createStripeCheckout/geoLocationiq/getPublicTrip/getStripePrices/getTripById/
getTripDetails/getUserPlan/parseBookingWithAi/planTripWithAi/triplanioAiReply).
CI-гард **2h `check-edge-sentry.mjs` ужесточён с «новых» на ВСЕ функции** —
сканит каждый index.ts, падает если нет wrapper/capture/manual → охват =
структурный инвариант (не потеряется). PR-цепочка: #498(шов+пилот copyTrip) →
#501(re-land 8 участники/инвайты, #499 ушёл не в dev) → #502(7 read/util) →
этот (10 функций + 5 маркеров + гард-на-все).
**★УНИФИКАЦИЯ инлайн-capture ЗАВЕРШЕНА (2026-07-16):** из 13 инлайн-capture 12
переведены на `withHandler` (внутренние catch/ретраи и in-flow throttle-репорты
`geoLocationiq` сохранены; неиспользуемый `captureEdgeError`-импорт вычищен).
`aiGate` ОСТАВЛЕН на инлайн-capture ОСОЗНАННО — его catch делает **fail-open**
(`return {allow:true}` 200, не блокировать бота при сбое), обёртка вернула бы 500.
Итоговая карта 44: **38 `withHandler`** + **5 `// sentry: manual`** (stripe-webhook/
telegramWebhook держат ещё и инлайн-capture) + **aiGate инлайн (fail-open)**.
Edge-охват ПОЛНОСТЬЮ унифицирован под один шов, кроме документированных исключений.
**Осталось по TRIP-219:** фронт (invoke-capture + route-boundaries) → трейсинг+
Session Replay → n8n Error Workflow + cron-монитор `getPendingReminders`.
