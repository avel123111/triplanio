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

**★ФРОНТ-ФАЗА — архитектура согласована (Pavel 2026-07-16), СТАРТ:** слоёная
модель, по ОДНОЙ центральной точке на класс ошибки (не 66 разрозненных, не одна
затычка): (F1) крэши рендера → route/feature **error-boundaries**; (—) непойманный
JS/promise → глобальные хендлеры SDK (уже есть); (F1) сбой вызова edge → **единый
`invokeFn`-шов** `src/lib/invokeFn.js` + CI-гард «сырой `functions.invoke` вне шва
не проходит»; (F3) ошибки React Query → глобальный `QueryCache/MutationCache.onError`
в `query-client.js`; (F3) прямой PostgREST/RLS → общий хелпер. Решения Pavel:
①фронт капчит то, что edge НЕ видит (сервер-4xx уже репортит edge → НЕ дублируем;
дедуп по `error.context`: есть Response=сервер видел=skip, нет=сеть/relay/200-error=
капчим); ②внутри — без фильтра ожидаемая/нет; квоту игнорируем; навигационный
`AbortError`/`Failed to fetch` остаётся в `ignoreErrors` (не ошибка). Порядок
F1→F2→F3, потом трейсинг+Replay (F5), n8n+cron (F6). `invokeFn` возвращает
`{data,error,code,message}` (drop-in для `supabase.functions.invoke`), парсит
`parseEdgeError` ОДИН раз (Response body читается однократно!) → мигрируемые
call-sites ОБЯЗАНЫ убрать свой `parseEdgeError`. Пилот: `src/lib/fx.js`.

**★СТАТУС 2026-07-17 (что реально в dev + куда пришли).**
ФРОНТ-ФАЗА ЗАВЕРШЕНА и в `dev`: F1 invokeFn-шов + гард 2i (`check-invoke-seam`,
сырой `functions.invoke` вне шва не проходит); F2 route+lens error-boundaries
(App.jsx + TripView); F3 `QueryCache/MutationCache.onError` в `query-client.js`;
F5a трейсинг 10% + Session Replay (только ошибки, всё маскировано) + PII-скраб на
`beforeSend` И `beforeSendTransaction`. Прямой PostgREST-слой покрыт КОНВЕНЦИЕЙ
`throw`/`writeRows` (бросает на ошибку/0-строк RLS), НЕ гардом — асимметрия, не
дыра (best-effort swallow'ы в partnerTracking/geo/i18n — намеренны).
**Severity-модель:** ожидаемые бизнес-4xx глушатся `x-sentry-skip` (инвайт-410,
checkout-409). НЕ строили центральный классификатор/типизированные исключения —
отвергли как оверинжиниринг. Живой шум TRIPLANIO-K (`getUserPlan responded 401`,
дохлая/негидратированная сессия из `useProStatus`) заглушён точечно: PR #525
(мёржён, `code:UNAUTHENTICATED`+skip) + PR #527 (открыт — не глушить настоящую
аварию Auth: `getRequestUserResult` различает 5xx→503 репортим vs 4xx→skip).
Унификацию 35 руками-написанных 401 в общий `requireUser` вынесли в **TRIP-239**
(радиус = все authed-функции вкл. платёжные → отдельно с гребом фронт-потребителей).

**N8N-ФАЗА — направление ИЗМЕНЕНО (Pavel 2026-07-17): n8n шлёт в Sentry НАПРЯМУЮ,
наш edge-релей НЕ делаем** (в коробочном Sentry-узле n8n нет create-issue → всё
равно нужен HTTP; Pavel не хочет звать наш API; DSN-креды в n8n уже есть). Схема:
- **Контур 1 (ошибки workflow):** один n8n workflow `Error Trigger → HTTP Request`
  → POST в Sentry store-endpoint `…/api/<PROJECT_ID>/store/?sentry_key=<PUBLIC_KEY>&sentry_version=7`
  с телом-событием (tags surface:n8n/workflow/node, fingerprint по workflow+node);
  прописать как «Error Workflow» в настройках 7 активных workflow'ов (TG Reminders,
  TG Chat Bot, InApp Group Chat Bot, TG Admin, AI Trip Parser, AI Trip Planner,
  AI Usage Logger). Sentry сам группирует события в issue — «create issue» не нужно.
- **Контур 2 (живость крона):** на free ОДИН cron-монитор → потрачен на самый
  критичный `tg-reminders` (id 1515295, GUID 609f96c1…, schedule `*/15`, margin 5,
  UTC — Pavel СОЗДАЛ). Чек-ин из n8n: HTTP-нода `…/api/<PROJECT_ID>/cron/tg-reminders/<PUBLIC_KEY>/?status=ok`
  СРАЗУ после `getPendingReminders` (на ветке, идущей КАЖДЫЙ тик, не после Split→AI→send,
  иначе ложные missed на пустых прогонах). instrumentation method при создании = **HTTP**
  (не Deno/NodeJS — SDK не используем). Пока пришёл 1 тестовый чек-ин, рекуррентный
  ещё НЕ провязан. Всё это — БЕЗ нашего кода (ни релея, ни правки getPendingReminders).

**Uptime (побочно):** авто-монитор `1464763` = Sentry-Uptime (не крон) на МЁРТВЫЙ
Vercel-preview, авто-создан 07.07 из URL в событии → снести + выключить «auto uptime
detect». Обсудили Uptime для Railway-сервисов: n8n `/healthz`, Tolgee `/actuator/health`
(фолбэк `/api/public/configuration`); Cyrus headless (нет входящего HTTP) → uptime-пинг
не подходит. На free uptime тоже лимитирован — проверить слоты.

**★ПОЙМАНО мониторингом (первый реальный сбой) 17.07 ~16:00:** тик TG Reminders упал
— нода HTTP к `getPendingReminders` получила `503 SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED`
(транзиторная деградация Supabase edge, НЕ наш код; prod). Привело к ПОТЕРЕ напоминаний:
`get_pending_reminders` — read-only SELECT (лог в `telegram_reminder_logs` пишет edge
ПОСЛЕ, она не выполнилась → не дедуп-проблема), НО окно скользящее `window_minutes=20`
при Schedule `*/15` → перекрытие тиков всего 5 мин → упавший тик теряет ~15 мин окна
безвозвратно. Фиксы вынесены в **TRIP-242** (High): retry на HTTP-ноде (Max Tries 3,
Wait 5000) + расширить `window_minutes` ≥30 (≥2× шага → один пропущенный тик само-лечится,
dedup не даст дубль). Опц. retry в AI Parser/Planner.

**ОСТАЛОСЬ по TRIP-219:** (1) провязать рекуррентный чек-ин `tg-reminders` в n8n; (2)
собрать n8n «Sentry Error Reporter» (Error Trigger→HTTP) + проставить в 7 workflow'ах;
(3) снести uptime-мусор 1464763 + выключить авто-детект; (4) usage-алерт квоты Sentry
(тумблер Pavel); (5) ручное — снести осиротевший edge-инстанс `getDailyReminders` на
dev+prod. Отдельно/вне 219: PR #527 (мердж), TRIP-239 (requireUser), TRIP-242 (reminders
resilience). Контур C (сквозной трейс browser→edge) — Pavel решил НЕ делать (нужен
isolation-scope рефактор edge, иначе только заголовки = бесполезно + CORS-поверхность).
