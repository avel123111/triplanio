# ТЗ для дизайнера — Страница API-документации Triplanio

**Версия:** 2026-05-30 · сверено с актуальной Notion-страницей «API & Integrations Reference»
**Заказчик:** Triplanio (travel-планировщик) · **Стек бэкенда:** Supabase Edge Functions, Stripe, n8n, Telegram, Google
**Формат результата от дизайнера:** Figma (desktop + mobile, light + dark, библиотека компонентов, кликабельный прототип ключевых интеракций)

---

## 1. Контекст и цель

У нас есть готовая текстовая документация по всем API/интеграциям (в Notion). Её содержание — финальное и проверенное; **придумывать API не нужно**, нужно красиво его подать.

Задача: спроектировать **страницу (мини-сайт) документации API** в стиле и layout лучших сервисов документации — **readme.io, Stripe Docs, Twilio, Mintlify, Supabase Docs**. Это должна быть не «простыня», а навигируемый референс с боковым меню, якорями, переключателями окружений и блоками кода с табами.

**Аудитория (по приоритету):**
1. Внутренние разработчики Triplanio — основной потребитель.
2. Интеграторы n8n / автоматизаций — работают с входящими вебхуками и server-to-server эндпоинтами.
3. На перспективу — внешние партнёры (если часть API станет публичной).

**Главный сценарий:** инженер открывает страницу, через поиск/меню находит нужный эндпоинт, мгновенно видит метод, URL (prod/dev), модель авторизации, тело запроса и пример ответа, копирует cURL/JS-сниппет.

---

## 2. Референсы и что у них берём

| Сервис | Что заимствуем |
|---|---|
| **readme.io** | Трёхколоночный layout, «карточка эндпоинта», правая панель с примером запроса/ответа, переключатель языков сниппета |
| **Stripe Docs** | Спокойная типографика, цветовые бейджи методов, «два столбца» (описание слева — код справа залипает при скролле), мягкие тени |
| **Mintlify / Supabase Docs** | Лёгкий тёмный/светлый режим, аккуратные callout-блоки, быстрый поиск (⌘K), генеративная навигация по якорям (scroll-spy) |
| **Twilio** | Группировка по продуктам/провайдерам, «breadcrumbs», табы окружений |

Тон: технологичный, чистый, «инженерный люкс». Никакого визуального шума, максимум воздуха, моноширинный шрифт для всего технического.

---

## 3. Информационная архитектура (sitemap)

Одностраничный док-сайт с якорной навигацией ИЛИ multipage (на усмотрение — см. §11). Структура разделов слева направо/сверху вниз:

```
Triplanio API Docs
├─ Overview (главная)
│   ├─ Введение
│   ├─ Окружения и базовые URL (Prod / Dev)
│   └─ Модели авторизации (5 типов)
├─ ИСХОДЯЩИЕ ИНТЕГРАЦИИ (Triplanio → вовне)
│   ├─ n8n (AI-автоматизация)         · callTriplanioAi, planTripWithAi, parseBookingWithAi
│   ├─ Stripe (платежи)               · createStripeCheckout, createBillingPortal, getStripePrices
│   ├─ Google Maps Platform           · placesAutocomplete, getMapsApiKey
│   ├─ FX-курсы (er-api)              · getFxRates
│   ├─ Telegram Bot API               · telegramStartLink, telegramGetBotInfo, telegramGetWebhookInfo
│   ├─ Email (Resend)                 · inviteTripMember, resendTripInvite, respondTripInvite
│   └─ Google OAuth (логин)
├─ ВХОДЯЩИЕ ВЕБХУКИ (вовне → Triplanio)
│   ├─ Stripe → stripe-webhook
│   ├─ Telegram → telegramWebhook
│   ├─ n8n → triplanioAiReply
│   ├─ n8n (cron) → getPendingReminders
│   ├─ n8n (cron) → getDailyReminders
│   ├─ Публичная шара → getPublicTrip
│   └─ Server-to-server → getTripById, getTripByTelegramChatId
├─ Внутренние automation-эндпоинты (seedTripBudget, syncTripExpense)
└─ Справочник секретов (env-переменные)
```

**Навигация (левый сайдбар):** двухуровневая. Верхний уровень — крупные секции (Overview / Исходящие / Входящие / Внутренние / Секреты). Под «Исходящими» и «Входящими» — провайдеры; под провайдером — список эндпоинтов. Активный пункт подсвечивается, при скролле работает scroll-spy.

---

## 4. Layout страницы (wireframe)

Базовый паттерн — **три колонки** (как readme.io / Stripe):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ТОП-БАР: [🔌 Triplanio API]   [⌘K Поиск...]      [Prod ⇄ Dev]   [🌗 тема]     │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│  ЛЕВЫЙ НАВ     │  ЦЕНТР: контент эндпоинта             │  ПРАВАЯ ПАНЕЛЬ (sticky) │
│  (sticky)      │                                       │                         │
│  Overview      │  ‹ Исходящие / n8n ›  (breadcrumbs)    │  ┌───────────────────┐ │
│                │                                       │  │ Request           │ │
│  ▸ Исходящие   │  ## callTriplanioAi        [POST]     │  │ [cURL][JS][n8n]   │ │
│    ▾ n8n       │  AI-ассистент в групп-чате            │  │                   │ │
│      callTrip… │                                       │  │  POST .../callTri…│ │
│      planTrip… │  Описание процесса (1–2 строки).      │  │  Authorization:…  │ │
│      parseBoo… │                                       │  │  { "chat_id": … } │ │
│    ▸ Stripe    │  [🔑 Auth: Bearer JWT(N8N_SECRET)]    │  └───────────────────┘ │
│    ▸ Google    │                                       │  ┌───────────────────┐ │
│    ▸ FX        │  URL Prod  POST  .../callTriplanioAi  │  │ Response 200      │ │
│    ▸ Telegram  │  URL Dev   POST  .../callTriplanioAi  │  │ { "ok": true }    │ │
│    ▸ Email     │  Внешний   POST  n8n/webhook/group…   │  └───────────────────┘ │
│  ▸ Входящие    │                                       │                         │
│  ▸ Секреты     │  ### Параметры тела                   │                         │
│                │  ┌────────┬──────┬──────┬──────────┐  │                         │
│                │  │ Поле   │ Тип  │ Req? │ Описание │  │                         │
│                │  └────────┴──────┴──────┴──────────┘  │                         │
│                │                                       │                         │
│                │  ── (следующий эндпоинт) ──           │                         │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

**Поведение колонок:**
- **Левый нав** — фиксированный, скроллится независимо, сворачивается в бургер на мобильном.
- **Центр** — основной контент, читаемая ширина (≈680–760px текстовой колонки).
- **Правая панель** — «липкая» (sticky), показывает Request/Response для эндпоинта, который сейчас в фокусе. На узких экранах (<1100px) уезжает под контент в виде блоков кода.
- **Топ-бар** — лого + глобальный поиск (⌘K) + **переключатель окружения Prod/Dev** (меняет все URL на странице) + переключатель темы.

**Якоря:** у каждого эндпоинта и заголовка — кликабельный якорь (#), URL копируется. При прокрутке активный пункт подсвечивается в левом меню.

---

## 5. Ключевые UI-компоненты (что нарисовать в библиотеке)

1. **HTTP-method badge** — пилюля с методом. Цвета: `POST` — синий/зелёный, `GET` — серый/голубой. (В нашем API почти всё `POST`.)
2. **Endpoint card** — заголовок-имя функции + method badge + краткое назначение + блок URL (Prod/Dev/Внешний) + auth-бейдж.
3. **Env switcher (Prod ⇄ Dev)** — сегмент-контрол в топ-баре. Переключает все базовые URL: `tizscxrpuopobgcxbekf.supabase.co` (Prod) ↔ `nydhzevdizkfaxdlikgc.supabase.co` (Dev).
4. **Auth-бейдж** — компактный индикатор модели авторизации с иконкой 🔑. Варианты: `User JWT`, `Bearer N8N_SECRET`, `Stripe signature`, `Query ?s=`, `Share-token`. Каждый — свой цвет.
5. **Code block с табами** — табы языков сниппета: `cURL`, `JavaScript (supabase-js)`, `n8n (HTTP Request node)`. Кнопка «копировать» в углу. Тёмная подсветка синтаксиса.
6. **Параметр-таблица** — колонки: Поле · Тип · Обяз. · Описание. Зебра, моноширинные имена полей.
7. **Request / Response пример** — две карточки в правой панели; у Response — бейдж статус-кода (200/400/401/403/409/502).
8. **Callout-блоки** — 4 типа: `info` (ℹ️ серый/синий), `success` (✅ зелёный), `warning` (🟠 оранжевый), `danger` (🔴 красный). Используются для заметок вроде «асимметрия n8n auth».
9. **Provider group header** — крупный разделитель секции провайдера с лого (n8n, Stripe, Google, Telegram, Resend) и одной строкой «Provider key: …».
10. **Secrets table** — таблица env-переменных: Имя · Назначение · Направление (вход/исход/внутр). Значения секретов **не показываем** — только имена.
11. **Search (⌘K)** — модальное окно поиска по эндпоинтам/провайдерам/секретам.
12. **Breadcrumbs** — «Исходящие / n8n / callTriplanioAi».
13. **«Copy»-кнопки** — у каждого URL, сниппета и имени секрета.

---

## 6. Визуальный стиль

- **Бренд:** опереться на текущую палитру Triplanio (travel, тёплые градиенты). Дизайнер берёт цвета/лого из существующего приложения (`src/api/brand.js`, `tailwind.config.js`, `public/`).
- **Темы:** обязательны **светлая и тёмная**. Тёмная — основной режим для кода.
- **Типографика:** гротеск для текста (читаемый, как Inter), моноширинный для кода/URL/имён полей (как JetBrains Mono / SF Mono).
- **Цвета методов и статусов:** единая семантика (2xx — зелёный, 4xx — янтарный/красный).
- **Плотность:** просторно, крупные отступы между эндпоинтами, тонкие разделители.
- **Иконки провайдеров:** n8n, Stripe, Google Maps, Telegram, Resend, Supabase — официальные/узнаваемые логотипы в group-заголовках.

---

## 7. Интерактив и состояния (для прототипа)

- Переключатель **Prod/Dev** перерисовывает все URL.
- Табы языков в блоке кода (cURL / JS / n8n).
- Scroll-spy: активный раздел подсвечивается в навигации.
- Поиск ⌘K.
- Тёмная/светлая тема.
- Hover/active/focus у пунктов меню, кнопок копирования (с состоянием «Скопировано ✓»).
- Свёрнутый сайдбар на мобильном (бургер), правая панель кода уезжает под контент.
- Адаптив: десктоп (3 колонки) → планшет (2 колонки, код под контентом) → мобайл (1 колонка, нав в drawer).

---

## 8. Полное содержание (что должно быть на страницах)

Ниже — весь контент, который нужно разместить. Тексты можно слегка редактировать стилистически, **данные (URL, имена ключей, payload) менять нельзя.**

### 8.0 Overview

**Введение:** «Единый справочник по всем внешним интеграциям Triplanio (Vercel + Supabase Edge Functions + Stripe). Указаны только имена секретов, не значения.»

**Окружения и базовые URL:**

| Окружение | Supabase-проект | База Edge Functions |
|---|---|---|
| Prod | `tizscxrpuopobgcxbekf` (eu-west-1) | `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/<fn>` |
| Dev | `nydhzevdizkfaxdlikgc` (eu-central-1) | `https://nydhzevdizkfaxdlikgc.supabase.co/functions/v1/<fn>` |

**Модели авторизации (5 типов — оформить как таблицу/легенду бейджей):**

| Модель | Как проверяется | Где |
|---|---|---|
| `User JWT` (verify_jwt=true + getRequestUser) | Валидный Supabase user JWT в `Authorization: Bearer`. Anon-ключ отклоняется. | Все user-facing функции |
| `Stripe signature` | Заголовок `stripe-signature` через `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `Query ?s=` | `?s=<TELEGRAM_WEBHOOK_SECRET>` | telegramWebhook |
| `Bearer N8N_SECRET` (сырой, не JWT) | `Authorization: Bearer <N8N_SECRET>` | triplanioAiReply, getPendingReminders, getDailyReminders, getTripById, getTripByTelegramChatId |
| `Share-token` | `{ token }` в теле == `trips.share_token` | getPublicTrip |

**Callout (warning) — обязательно вынести заметно:** «Асимметрия авторизации n8n (by design). Исходящие Triplanio→n8n подписываются как HS256-JWT из N8N_SECRET (signN8nJwt, 5 мин). Входящие n8n→Triplanio используют сырой N8N_SECRET как Bearer. Один секрет, два формата — не "упрощать".»

---

### 8.A Исходящие интеграции

Каждый эндпоинт = карточка (имя + method badge + назначение + URL Prod/Dev + Внешний вызов + Auth + payload + ответ).

**A.1 n8n (AI-автоматизация)** — Provider key `N8N_SECRET` · база (захардкожена) `https://n8n-production-d1214.up.railway.app` · Auth: Bearer HS256-JWT(N8N_SECRET).

- **callTriplanioAi** [POST] — AI-ассистент в групп-чате. Edge fn Prod/Dev `.../callTriplanioAi` (verify_jwt=true). Внешний: `POST .../webhook/group-chat`. Payload:
  ```json
  { "payload": { "chat_id":"…","trip_id":"…","user_message":"…",
    "messages":[{"id":"","user_id":"","user_full_name":"","text":"","created_at":""}],
    "requested_by":{"user_id":"","email":"","full_name":""} } }
  ```
  Ответ ИИ приходит позже через `triplanioAiReply` (B.3).
- **planTripWithAi** [POST] — AI-планировщик трипа. Внешний: `.../webhook/ai-trip-planner`. Payload: `{ "sessionId":"…","prompt":"…","language":"ru" }`. Возвращает `{ draft, ai_comment }`.
- **parseBookingWithAi** [POST] — распознавание брони из документа. Внешний: `.../webhook/parse-booking`. Payload: `{ "kind":"hotel|transfer","fileUrls":["…"],"text":"" }`.

**A.2 Stripe (платежи)** — Provider key `STRIPE_SECRET_KEY` · SDK `npm:stripe@17.0.0` → api.stripe.com · режим test/live по ключу (sk_test_…/sk_live_…), один режим на проект.

Таблица продуктов:

| План | LIVE product | TEST product |
|---|---|---|
| pro_trip | `prod_UYfZZsZnknkxDj` | `prod_UZnCx7GA3YlLJd` |
| pro_monthly | `prod_UYfZf8WvFNE3cI` | `prod_UZnBPOlJL0xmue` |
| pro_yearly | `prod_UYfZBYzOWrKiLu` | `prod_UZnBUDGL1PuyEN` |

- **createStripeCheckout** [POST] — старт Checkout-сессии. Stripe-вызовы: checkout.sessions.list (race-guard), products.retrieve(+default_price), prices.list, checkout.sessions.create. Guards: Origin==PUBLIC_APP_URL; владелец для pro_trip; блок дубля подписки; отказ при checkout «в полёте». Payload: `{ "tripId":"опц.","planType":"pro_trip|pro_monthly|pro_yearly","returnPath":"/…","locale":"ru" }`. Ответ `{ url }`.
- **createBillingPortal** [POST] — управление подпиской. Stripe: subscriptions.retrieve, billingPortal.sessions.create. Payload `{ "returnPath":"/settings" }`. Ответ `{ url }`.
- **getStripePrices** [POST] — актуальные цены. Тело: нет. Ответ `{ prices: { plan: { plan_type, price_id, product_id, unit_amount, currency, recurring_interval } } }`.
- *Callout (info):* checkSubscriptionStatus и getUserPlan НЕ ходят в Stripe (читают Supabase) — не внешняя интеграция.

**A.3 Google Maps Platform** — Provider key `GOOGLE_MAPS_API_KEY` · база `https://maps.googleapis.com/maps/api` · Auth: `key=…` в query.

- **placesAutocomplete** [POST] — прокси Places + Time Zone. Три экшена: `autocomplete` `{input,sessionToken?,types?,language?}`→`{predictions}`; `details` `{placeId,sessionToken?}`→`{result}`; `timezone` `{lat,lng,timestamp?}`→сырой ответ Google.
- **getMapsApiKey** [POST] — выдаёт referrer-restricted Maps JS ключ (за авторизацией). Ответ `{ apiKey }`.

**A.4 FX-курсы (er-api)** — без ключа.

- **getFxRates** [POST] — Provider `open.er-api.com` (бесплатно, включает RUB). Внешний: `GET https://open.er-api.com/v6/latest/<BASE>`. Кэш в таблице fx_rates, обновление после 48ч, при сбое — stale. Тело `{ base? }` (деф. EUR) → `{ base, rates, fetched_at, source:'er-api', age_hours, cached }`.

**A.5 Telegram Bot API** — Provider key `TELEGRAM_BOT_TOKEN` · база `https://api.telegram.org/bot<TOKEN>` · Auth: токен в пути.

| Функция (verify_jwt=true) | Telegram-метод | Назначение |
|---|---|---|
| telegramStartLink `{tripId}` | GET /getMe | Deep-link t.me/<bot>?start=<token>; one-time токен (TTL 10 мин) в telegram_link_tokens |
| telegramGetBotInfo | GET /getMe | `{ id, username, first_name }` |
| telegramGetWebhookInfo (admin-only, ADMIN_EMAILS) | GET /getWebhookInfo | Диагностика вебхука |
| telegramWebhook (ответная нога) | POST /sendMessage | Шлёт подтверждение/подсказку в чат |

- *Callout (info):* telegramGetIntegration, telegramSetActive, telegramDisconnect — только БД, verify_jwt=true, тело `{ tripId, … }`.

**A.6 Email (Resend)** — Provider key `RESEND_API_KEY` · `POST https://api.resend.com/emails` · Auth: Bearer RESEND_API_KEY · From: `EMAIL_FROM` (деф. noreply@triplanio.com) · хелпер `_shared/sendEmail.ts` (best-effort).

| Функция (verify_jwt=true) | Когда шлётся письмо |
|---|---|
| inviteTripMember | Приглашение участника (ссылка из PUBLIC_APP_URL) |
| resendTripInvite | Повторная отправка инвайта |
| respondTripInvite | Уведомление инвайтеру о принятии/отклонении |

**A.7 Google OAuth (логин)** — Provider key `VITE_GOOGLE_CLIENT_ID`. Не Edge Function: SPA через Google-провайдер Supabase Auth (redirect + One Tap). Обмен токенов Google↔Supabase Auth (`https://<ref>.supabase.co/auth/v1/callback`).

---

### 8.B Входящие вебхуки

Карточка = Provider + URL Prod/Dev + Платформа (verify_jwt) + Проверка/Auth + Provider keys + События/Payload + «Отдаёт наружу».

- **B.1 Stripe → stripe-webhook** — `POST .../stripe-webhook`, verify_jwt=false. Проверка: stripe-signature → constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET). Keys: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY. События: checkout.session.completed, customer.subscription.updated/deleted, charge.refunded, charge.dispute.created. Эффекты: trips.is_pro_trip, users.subscription_status/_end_date, trip_subscriptions, notifications; идемпотентность через stripe_events. Отдаёт `{ received: true }`.
- **B.2 Telegram → telegramWebhook** — `POST .../telegramWebhook?s=<TELEGRAM_WEBHOOK_SECRET>`, verify_jwt=false. Проверка: query ?s= == TELEGRAM_WEBHOOK_SECRET. Payload: Telegram Update. Поведение: `/start <token>` гасит telegram_link_tokens, апсертит trip_telegram_integrations, отвечает sendMessage. Всегда 200.
- **B.3 n8n → triplanioAiReply** — `POST .../triplanioAiReply`, verify_jwt=false · Bearer N8N_SECRET (сырой). Эффект: вставляет сообщение ИИ в chat_messages как бот-юзер (info@triplanio.com), текст ≤ 4000. Payload `{ "chat_id":"…","message":"Текст ответа от ИИ" }`.
- **B.4 n8n (cron) → getPendingReminders** — `POST .../getPendingReminders`, Bearer N8N_SECRET. RPC get_pending_reminders(window_minutes); пред-лог в telegram_reminder_logs (дедуп). Payload `{ "window_minutes": 15 }`. Отдаёт `{ reminders:[{type,user_id,user_locale,trip_id,chat_id,context}] }`.
- **B.5 n8n (cron) → getDailyReminders** — `POST .../getDailyReminders`, Bearer N8N_SECRET. type → STABLE SQL get_trips_*_tomorrow; fire-and-forget. Payload `{ "type":"hotel_checkin|hotel_checkout|hotel_cancel|transfer|activity|car_pickup|car_dropoff" }`. Отдаёт `{ type, reminders:[…] }`.
- **B.6 Публичная шара → getPublicTrip** — `POST .../getPublicTrip`, verify_jwt=false · `{token}`==trips.share_token. Отдаёт `{ trip (created_by и share_token вырезаны), visits, hotels, transfers, activities, carRentals }`. Payload `{ "tripId":"…","token":"…" }`. *Callout (info):* share-token выдаёт ensureShareToken (verify_jwt=true, владелец).
- **B.7 Server-to-server → getTripById / getTripByTelegramChatId** — verify_jwt=false · **Bearer N8N_SECRET (сырой)** (закрыто 2026-05-30 через requireN8nSecret). `{ id }` / `{ telegram_chat_id }` → полный payload трипа (участники, бюджеты, расходы). *Callout (success ✅):* «Защищено Bearer N8N_SECRET; без токена — 401, user-JWT — 401.»

---

### 8.C Внутренние automation-эндпоинты (отдельная секция, помечена «internal»)

| Функция | Триггер | Payload |
|---|---|---|
| seedTripBudget | Создан трип | `{ tripId }` или `{ event:{ entity_name:'Trip', entity_id } }` |
| syncTripExpense | Изменение Hotel/Activity/Transfer/Service | `{ event:{ entity_name, entity_id, event_type } }` или `{ sourceKind, sourceId, tripId, action }` |

---

### 8.D Справочник секретов (отдельная страница)

**Edge Function secrets** (только имена, без значений): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (не отдавать наружу), `N8N_SECRET` (вход+исход), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_APP_URL`, `ADMIN_EMAILS`.

**Frontend build-переменные** (публичны by design): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_MAPS_KEY`, `VITE_TRIPLANIO_BOT_USER_ID`.

Оформить как таблицу с колонкой «Направление» (вход / исход / внутр.) и иконками-стрелками.

---

## 9. Что НЕ показывать на этой странице

- **Часть E «Находки и оптимизации»** из Notion (внутренний тех-долг: захардкоженный n8n URL, дублирование хелперов, telegramStartLink email/user_id и т.п.) — это инженерные заметки, не API-референс. В дизайне док-страницы их нет.
- **Значения** любых секретов/токенов — только имена ключей.
- Если страница станет публичной — скрыть внутренние server-to-server эндпоинты (B.7) и секцию «internal» (8.C), а также боевые URL вебхуков. См. §11.

---

## 10. Дизайн-deliverables

1. Figma-файл: Overview + 1 «эталонный» экран эндпоинта (n8n/callTriplanioAi) + экран входящего вебхука + страница секретов.
2. Light + Dark темы.
3. Библиотека компонентов из §5 (method badge, auth badge, endpoint card, code-tabs, param-table, callouts ×4, env-switcher, secrets-table, search).
4. Адаптив: desktop / tablet / mobile.
5. Кликабельный прототип: переключатель Prod/Dev, табы языков кода, навигация по якорям, поиск ⌘K.

---

## 11. Открытые вопросы (решить до старта)

1. **Публичная или внутренняя** документация? От этого зависит, прятать ли server-to-server эндпоинты, секцию internal и боевые URL.
2. **Реализация:** готовый сервис (readme.io / Mintlify / GitBook) с их шаблонами, или **кастомная страница** под полный контроль брендинга? Это меняет рамки дизайна (в готовых сервисах часть layout задана платформой).
3. **Бренд-ассеты:** дать дизайнеру лого/палитру Triplanio и гайд, если есть.
4. **Однастраничный** скролл-док или **multipage** с роутингом? (Рекомендация: multipage по провайдерам — лучше масштабируется.)
5. Нужны ли **«Try it» / live-запросы** (как в readme.io) или примеров кода достаточно? «Try it» требует прокси и обращения с секретами — отдельная задача.
