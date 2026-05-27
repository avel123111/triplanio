# Аудит миграции Triplanio: Base44 → Supabase + Vercel
**Дата:** 2026-05-27
**Метод:** проверка по факту — код обоих репозиториев, коннекторы Supabase (`tizscxrpuopobgcxbekf`) и Vercel (`triplanio_app`), сверка с эталоном base44.
**Вывод одной строкой:** инфраструктура и серверная «операционная» логика готовы, но **весь слой записи данных (CRUD) ещё на base44**, поэтому новое приложение пока не функционирует против нового бэкенда. Реальная готовность к полному запуску — **~40%**.

---

## 1. Что является эталоном

`triplanio_base44` (прод на app.triplanio.com) — источник истины. В нём:
- ~190 файлов фронтенда, 22 сущности (entities), ~40 серверных функций;
- 10 «линз» трипа: Хронология, Карта, Календарь, Бюджет, Отели, Документы, Участники, Настройки, ИИ, Чат;
- сложные диалоги: Hotel/Transfer/Activity/CityVisit/Service/CarRental + AI-загрузка из файла, выбор платформ бронирования, проверка подписки.

Новое приложение в конце миграции должно повторить всю эту логику.

---

## 2. Бэкенд (Supabase prod) — проверено через коннектор

### Edge Functions: 26 задеплоено, все ACTIVE ✅
Подтверждено напрямую. Покрыто: участники (invite/respond/remove/updateRole/resend/resolveProfiles), Stripe (getUserPlan/getStripePrices/createCheckout/billingPortal/webhook), Telegram (webhook/getIntegration/setActive/getBotInfo/getWebhookInfo/startLink), утилиты (getTripDetails, triplanioAiReply, ensureShareToken, placesAutocomplete, seedTripBudget, syncTripExpense, copyTrip, deleteMyAccount, sendTripReminders).

### ❌ Функции, на которые ссылается фронт, но которых НЕТ ни в деплое, ни в репозитории
Это реальный пробел — не просто «не подключено», а «не написано/не задеплоено»:

| Функция | Где вызывается | Последствие |
|---|---|---|
| `checkSubscriptionStatus` | HotelDialog, TransferDialog, AiTripPlanner | гейтинг PRO-функций сломается |
| `getActiveTrips` | TripLimitDialog, AiTripPlanner | лимит трипов не проверяется |
| `getFxRates` | lib/fx.js | конвертация валют в бюджете |
| `getMapsApiKey` | MapView | карта |
| `getPublicTrip` | PublicTrip (публичная страница) | публичный просмотр трипа |
| `planTripWithAi` | AiTripPlanner | ИИ-планировщик трипа |
| `telegramDisconnect` | TelegramAssistantPanel | отключение Telegram |
| `addOfflineTripMember` | **MembersLens (новый код)** | добавление офлайн-участника |

Отложены осознанно: `exportTripPdf`, `backfillTripBudget`.

### Схема и данные
Все 22 доменные таблицы есть, RLS включён. **Но контентные таблицы пустые** — данные не мигрированы:

| Таблица | Строк |
|---|---|
| users | 6 (тестовые) |
| trips | 4 (тестовые) |
| city_visits | 14 |
| trip_budgets | 1 |
| **hotel_stays, activities, transfers, trip_members, chat_messages, trip_documents, trip_services …** | **0** |

### ⚠️ Безопасность и мусор
- `n8n_chat_histories` — **RLS отключён**, 276 строк, доступно любому с anon-ключом. Не исправлено с прошлого аудита.
  Remediation (применять осознанно, после добавления политик): `ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;`
- В БД остались «мусорные» таблицы: `testTable`, `n8n_chat_messages` — убрать перед продом.

---

## 3. Vercel — проверено через коннектор

- Проект `triplanio_app` (Vite), последний production-деплой **READY**, автодеплой с GitHub `main`.
- **Домены `triplanio.com` и `www.triplanio.com` уже привязаны к этому проекту.** То есть новое приложение технически уже отдаётся на triplanio.com, тогда как реальный прод для пользователей — это base44 на app.triplanio.com.
- `live: false` на проекте; в истории был один ERROR-деплой («implement all 6 lenses»), затем починен.

---

## 4. Фронтенд — реальное состояние wiring

Метрика: **~55 файлов всё ещё ссылаются на `base44`, ~50 из них делают активные вызовы.** Это больше, чем фиксировала память (26). Ключевой вывод: **чтение** в новых экранах переведено на Supabase, а **запись (create/update/delete всех сущностей) на 100% осталась на base44.**

### ✅ Переведено на Supabase
- Аутентификация и шапка: `AuthContext`, `Login` (Google OAuth), `AppHeader`, `UserMenu`, `NotificationsBell`.
- `Trips` (список) и `ManualPlanner` (создание, через RPC `create_trip`).
- `TripView` — оболочка + чтение данных через `getTripDetails`.
- Заново переписанные линзы со своими Supabase-диалогами: **Budget, Members, Calendar, Docs, Settings, AI**.

### Готовность линз трипа (детально — то, что ты просил)

| Линза | Чтение | Запись/логика | Вердикт |
|---|---|---|---|
| **Хронология** | ✅ Supabase | диалоги Hotel/Transfer/Activity/CityVisit пишут в **base44**; клик по событию `onClick={() => {}}` — **ничего не открывает** | 🟠 читается, но **редактирование уходит в старую БД** и не отражается; нет view-диалогов |
| **Бюджет** | ✅ | ✅ свои диалоги: `budget_expenses`/`budget_categories` insert/update/delete, `seedTripBudget` | 🟢 готова (нужен `getFxRates` для валют) |
| **Участники** | ✅ | ✅ Supabase-функции invite/remove/updateRole/resend | 🟡 готова, но зовёт **несуществующую `addOfflineTripMember`** |
| **Календарь** | ✅ | read-only, выводится из stream/visits | 🟢 готова (просмотр) |
| **Документы** | ✅ | ✅ Supabase Storage `documents` + `trip_documents` CRUD | 🟢 готова |
| **Настройки** | ✅ | ✅ `trips` update/delete; часть фич-тоглов помечены «Скоро» | 🟡 в основном готова |
| **ИИ-помощник** | — | ✅ `triplanioAiReply` | 🟢 готова |
| **Чат** | ⚠️ | Realtime реализован, но обращается к таблице **`trip_messages`, которой нет в схеме** (есть `chat_messages`) | 🔴 **сломана** — читает/пишет/подписывается на несуществующую таблицу |
| **Отели** | ❌ | «layout-only — no real data queries yet», мок-данные | 🔴 не функциональна |
| **Карта** | ❌ | рендерит `LensStub` («Скоро здесь будет контент») | 🔴 не реализована |

### Главный архитектурный разрыв
`TripView` читает из **нового** бэкенда (`getTripDetails` → Supabase), а диалоги хронологии (`HotelDialog`, `TransferDialog`, `ActivityDialog`, `CityVisitDialog`) пишут в **старый** через `base44.entities.*`. Это две разные базы. Поэтому добавленные в хронологии отель/переезд/активность не появятся в новом приложении. Линзы, которые переписали «с нуля» (Budget, Docs, Members), не используют старые диалоги и работают на Supabase — именно поэтому они готовы, а Хронология — нет.

### Легаси-страницы, всё ещё в роутинге и на base44
Дублируют уже переписанные линзы, но остаются подключены и тянут base44:
- `/trip/:id/budget` → `TripBudget.jsx` (**16** вызовов base44) — заменён `BudgetLens`;
- `/trip/:id/settings` → `TripSettings.jsx` (9) — заменён `SettingsLens`;
- `/settings` → `Settings.jsx` (7, аккаунт/биллинг);
- `/plan-trip-ai` → `AiTripPlanner.jsx` (6);
- `/admin`, `/admin/notifications`, `/public/trip/:id`.

Плюс ~30 общих компонентов на base44: все *Dialog, члены (`TripMembersBar`/`Card`/`CollabBar`), `lib/chat.js`, `lib/fx.js`, `lib/useUserProfiles.js`, `lib/timezone-resolver.js`, `lib/i18n` (locale через base44.auth), `AddressAutocomplete`, `MapView`, AI-загрузки и т.д.

---

## 5. Прогресс по фазам (пересчитано по факту)

```
Фаза 1  Edge Functions     ████████████████░░░░  ~85%  (26 готовы; ~8 нужных не написаны; 2 отложены)
Фаза 1б Дизайн /ui          ████████████████████  100%  (синхронизирован, но это только превью /ui)
Фаза 2  Wiring фронтенда    █████████░░░░░░░░░░░   ~45%  (чтение+6 линз; вся запись и 6 страниц на base44)
Фаза 3  Realtime чат        █████████████░░░░░░░  код есть, но БИТ (не та таблица) → 0% рабочего
Фаза 4  Webhooks / cron     ░░░░░░░░░░░░░░░░░░░░    0%
Фаза 5  Миграция данных     ░░░░░░░░░░░░░░░░░░░░    0%  (контентные таблицы пусты)
Фаза 6  DNS / прод-свитч    ████░░░░░░░░░░░░░░░░   ~20% (домен привязан; base44 ещё источник истины)
```

**Итого до полной миграции (бек + фронт): ~40%.**

---

## 6. Что осталось сделать — приоритизированный список

**🔴 Блокеры функциональности (без этого новый бек не работает как приложение):**
1. Перевести весь CRUD на Supabase: диалоги Hotel/Transfer/Activity/CityVisit/Service/CarRental/Document/TripForm + удаления (`HotelTimeline`, `ActivityList`, `TransferStrip`). Сейчас всё в `base44.entities`.
2. Починить **Чат**: таблица `trip_messages` → `chat_messages` (или создать вьюху/таблицу), иначе чтение/инсерт/realtime падают.
3. Дописать и задеплоить **8 недостающих edge-функций** (особенно `checkSubscriptionStatus`, `addOfflineTripMember`, `getFxRates`, `getPublicTrip`, `planTripWithAi`).
4. Хронология: повесить на `StreamEventRow.onClick` открытие view-диалогов (Hotel/Transfer/Activity) — сейчас пустой обработчик.

**🟡 Полнота экранов:**
5. **Отели** — заменить мок на реальные данные (голосование за отели, аппруверы).
6. **Карта** — реализовать `MapView` вместо `LensStub` (нужен `getMapsApiKey`).
7. Перевести легаси-страницы `/settings`, `/plan-trip-ai`, `/admin`, `/public/trip` на Supabase или убрать дубли (`TripBudget`, `TripSettings`).
8. Перевести общие либы: `lib/chat.js`, `lib/fx.js`, `useUserProfiles`, `useTripAccess`, `timezone-resolver`, `i18n` (язык через `base44.auth.updateMe`), `partnerTracking`.

**🟢 Инфраструктура и запуск:**
9. Фаза 4: переключить Stripe webhook и Telegram webhook на новые URL Edge Functions, настроить cron для `sendTripReminders`, добавить секреты (`GOOGLE_MAPS_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_EMAILS`, `TRIPLANIO_AI_CALLBACK_SECRET`).
10. Фаза 5: экспорт данных из base44 → трансформация ID (string → UUID), маппинг `created_by` (email → auth uid) → импорт → проверка RLS/FK.
11. Безопасность: включить RLS на `n8n_chat_histories`, удалить `testTable`/`n8n_chat_messages`.
12. Фаза 6: финальный тест на preview → роутинг `/trips/*` на новый билд → отключить base44.

---

## 7. Рекомендованный порядок работ
CRUD-диалоги хронологии (Hotel→Transfer→Activity→CityVisit) → недостающие edge-функции → фикс чата → клики в хронологии → Отели/Карта → легаси-страницы и общие либы → Stripe/Telegram/cron → миграция данных → прод-свитч.
