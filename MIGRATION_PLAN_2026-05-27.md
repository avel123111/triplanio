# Triplanio — план миграции до прод-запуска
**Дата:** 2026-05-27
**Цель:** перенести ВСЮ логику base44 (прод app.triplanio.com) на новые экраны (Supabase + Vercel), ничего не потеряв, и запустить прод на triplanio.com.

## Скоуп — что мы делаем и чего НЕ делаем
Эталон — base44. Целевой набор экранов трипа:

**Линзы (раздел «Путешествие»):** `timeline`, `map`, `calendar`*, `budget`* , `documents`, `chat`*
**Управление:** `members`, `settings`, `share`
(* `calendar`, `budget`, `chat` гейтятся аддонами `Trip.details.addons`; `budget`/`chat`/`telegram` — только Pro.)

**НЕ делаем** (нет в base44): отдельный «ИИ-чат» (`AILens`) и «выбор отелей» (`HotelsLens`). ИИ живёт ВНУТРИ группового чата (`@triplanio` → `triplanioAiReply`). Аддон `hotels_selection` в конфиге есть, но экрана нет — пропускаем.

Принцип работы: для каждого элемента сперва читаем цепочку в base44 целиком (правило `triplanio-code-analysis-rule`), затем портируем логику на новый экран, сверяя с дизайном `/ui` (`redesign/Screen*.jsx` ← `Triplanio App 2`).

---

## P0 — Зачистка скоупа (быстро, чтобы не делать лишнего)
0.1 Убрать из `TripView` линзы `ai` и `hotels`: удалить из `LENS_ITEMS`/`MGMT_ITEMS`, из роутинга линз и из `window.__navigate`. Удалить `AILens.jsx`, `HotelsLens.jsx`.
0.2 Привести сайдбар к набору base44: Путешествие = timeline/map/calendar/budget/documents/chat; Управление = members/settings/share.

## P1 — Перевод всего CRUD на Supabase (ГЛАВНЫЙ блокер)
Сейчас `TripView` читает из Supabase (`getTripDetails`), но запись всех сущностей идёт в base44. Перевести каждую сущность на прямые `supabase.from()` под RLS (или edge-функцию там, где нужна серверная логика). После — инвалидация `TRIP_SHELL_KEY/TRIP_CONTENT_KEY`.

1.1 **CityVisit** — `CityVisitDialog` (create/update) + удаление города/визита. (используется и в edit-mode хронологии)
1.2 **HotelStay** — `HotelDialog` (create/update) + `HotelTimeline` delete + `HotelAiUpload` (парсинг брони из файла — нужен аналог `InvokeLLM`/Storage).
1.3 **Transfer** — `TransferDialog` (create/update, в т.ч. парный обратный) + `TransferStrip` delete + `TransferAiUpload`.
1.4 **Activity** — `ActivityDialog` (create/update) + `ActivityList` delete.
1.5 **Trip** — `TripFormDialog` (create/update) + `TripHeader` delete + загрузка обложки/аватара в Supabase Storage.
1.6 **TripService** — `ServiceDialog` + `CarRentalDialog` (CRUD) И **подключить виджет «Сервисы»** в `TripView` (сейчас кнопки без обработчиков).
1.7 **Чат** — `lib/chat.js` + `ChatLens`: исправить имя таблицы (`trip_messages` → `chat_messages`), `chat_reads` (unread), realtime-канал, **ИИ-меншн** (`@triplanio` → `triplanioAiReply`), `useUserProfiles`.
1.8 **Общие либы на base44:** `useUserProfiles` (resolveProfiles), `useTripAccess`, `timezone-resolver` (placesAutocomplete), `AddressAutocomplete` (placesAutocomplete), `lib/fx.js` (getFxRates), `lib/i18n/I18nContext` (язык: `base44.auth.updateMe` → Supabase profile), `partnerTracking` (PartnerClick), `budget/SourceViewLoader` (entities.get), `lib/PageNotFound` (base44.auth.me).

## P2 — Недостающие edge-функции (написать + задеплоить + перевести фронт на `supabase.functions`)
Вызываются фронтом, но не существуют ни в репо `supabase/functions`, ни в деплое:
- `checkSubscriptionStatus` — гейтинг Pro в HotelDialog/TransferDialog/AiTripPlanner
- `getActiveTrips` — лимит трипов (TripLimitDialog, AiTripPlanner)
- `getFxRates` — курсы валют для бюджета
- `getMapsApiKey` — карта
- `getPublicTrip` — публичная страница трипа
- `planTripWithAi` — ИИ-планировщик
- `telegramDisconnect` — отключение Telegram
- `addOfflineTripMember` — офлайн-участник (уже зовётся новым `MembersLens`)

## P3 — Экраны, ещё не портированные (лежат на `/ui`, не подключены)
3.1 **`/inbox` (Уведомления)** — СОЗДАТЬ роут + подключить `NotificationsBell`/Inbox (дизайн `ScreenInbox`) + `notifications-catalog`. Сейчас колокольчик ведёт в никуда.
3.2 **`/settings` (Аккаунт)** — портировать на Supabase (`ScreenAccount`): план/`getUserPlan`, billing-portal, аватар, язык, удаление аккаунта, нотификации.
3.3 **`/plan-trip-ai`** — портировать (`ScreenAiPlanner`) + `planTripWithAi` + создание Trip/CityVisit/Activity через Supabase.
3.4 **`/public/trip/:id`** — портировать (`ScreenPublic`) + `getPublicTrip` (read-only).
3.5 **Pro/Upgrade-флоу** — `UpgradePlanDialog`, `TripLimitDialog`, `WelcomeToProDialog`, `ProBadge`, `AiFeatureLock` (дизайн `ScreenPro`): перевести на `getStripePrices`/`createStripeCheckout`/`createBillingPortal` (функции уже есть).
3.6 **Admin** — `/admin`, `/admin/notifications` на Supabase.
3.7 **Легаси-дубли** — решить судьбу `/trip/:id/budget` (`TripBudget.jsx`, 16 вызовов base44) и `/trip/:id/settings` (`TripSettings.jsx`): заменены `BudgetLens`/`SettingsLens` → удалить или сделать редиректом на линзу.

## P4 — Полнота и паритет с base44
4.1 **Аддон-гейтинг** в `TripView`: показывать calendar/budget/chat по `isAddonEnabled(trip, …)` + Pro; в `SettingsLens` подключить тоглы аддонов (`Trip.details.addons`) — сейчас «Скоро».
4.2 **Хронология — клик по событию:** `StreamEventRow onClick={() => {}}` → открывать view-диалоги `HotelViewDialog`/`TransferViewDialog`/`ActivityViewDialog`/`CarRentalViewDialog`.
4.3 **Хронология — edit-mode паритет:** удаление города/визита, редактирование заметок визита (кнопка в `CityHero` → `onEditVisitNotes`).
4.4 **Map lens** — `MapView` (Leaflet/Google) + маркеры городов + `getMapsApiKey` (вместо `LensStub`).
4.5 **Calendar lens** — сверить паритет с base44 (`CalendarView` + `dragEvents.js`, drag-перенос).
4.6 **Бронирование/партнёрки** — `buildBookingPlatforms`, `BookHotelButton`, `BookingLinkButton`, `partnerTracking`.
4.7 **Telegram-ассистент** — `TelegramAssistantPanel` (+ `telegramDisconnect`).
4.8 **i18n** — убедиться, что ru/en/es полностью подключены и переключение языка сохраняется.

## P5 — Внешние интеграции и данные
5.1 Stripe webhook → URL `…/functions/v1/stripe-webhook` + `STRIPE_WEBHOOK_SECRET`.
5.2 Telegram webhook → `telegramSetWebhook` на новый URL.
5.3 `sendTripReminders` — cron каждые 15 мин (pg_cron/n8n, admin JWT).
5.4 Секреты Supabase: `GOOGLE_MAPS_API_KEY`, `ADMIN_EMAILS`, `TRIPLANIO_AI_CALLBACK_SECRET`, Stripe/Telegram ключи.
5.5 **Миграция данных** base44 → Supabase: экспорт всех сущностей → ID string → UUID → `created_by` email → auth uid → импорт → проверка RLS/FK. (контентные таблицы сейчас пусты)
5.6 Отложенное: `exportTripPdf`, `backfillTripBudget`.

## P6 — Безопасность и прод-свитч
6.1 Включить RLS на `n8n_chat_histories` (с политиками); удалить мусор `testTable`, `n8n_chat_messages`.
6.2 Финальное тестирование на Vercel preview (все линзы, роли owner/admin/viewer, Pro/Free).
6.3 Роутинг `triplanio.com/trips` на новый билд (домен уже привязан к Vercel-проекту), затем отключить base44.

---

## Порядок исполнения (рекомендуемый)
**P0** (зачистка) → **P1.1–1.6** (CRUD трипа: города/отели/переезды/активности/трип/сервисы) → **P2** (функции, которые нужны этому CRUD: checkSubscriptionStatus, getFxRates) → **P4.1–4.3** (аддоны, клики, edit-mode) → **P1.7** (чат+ИИ) → **P3.1–3.5** (inbox, аккаунт, ИИ-планировщик, публичный, Pro) → **P4.4–4.8** (карта, календарь, бронирования, telegram, i18n) → **P3.6–3.7, P1.8** (admin, легаси, либы) → **P5** (интеграции+данные) → **P6** (безопасность+свитч).

## Готово на сегодня (не трогаем, кроме мелких правок)
Auth/OAuth, шапка, `Trips` (список), `ManualPlanner` (создание), `TripView` shell (чтение), линзы **Budget / Documents / Calendar(view) / Members** на Supabase. 26 edge-функций ACTIVE.
