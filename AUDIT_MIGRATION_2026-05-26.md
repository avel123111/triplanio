# Аудит миграции Triplanio: Base44 → Supabase + Vercel
**Последнее обновление:** 2026-05-27  
**Статус:** 🔶 Edge Functions завершены — идёт переключение фронтенда

---

## Общая картина

Фаза 1 (Edge Functions) полностью завершена. 26 серверных функций задеплоены и активны в Supabase prod. Следующий этап — Фаза 1б (финализация дизайна `/ui`) и Фаза 2 (wiring: подключение фронтенда к новым функциям).

---

## ✅ Что сделано

### Инфраструктура
- Supabase **prod** (`tizscxrpuopobgcxbekf`, eu-west-1) — работает
- Supabase **dev** (`nydhzevdizkfaxdlikgc`, eu-central-1) — работает
- **Схема БД**: все 22 таблицы перенесены (trips, city_visits, hotel_stays, activities, transfers, trip_members, notifications, trip_budgets, budget_categories, budget_expenses, fx_rates, trip_services, trip_documents, trip_subscriptions, stripe_events, trip_telegram_integrations, telegram_link_tokens, telegram_reminder_logs, partner_clicks, chat_messages, chat_reads, users)
- **RLS-политики**: включены на всех таблицах (кроме n8n_chat_histories — см. ⚠️)
- **Storage**: бакеты `documents` и `avatars` настроены
- **Google OAuth**: настроен для dev и prod
- **Env переменные**: прописаны в Vercel и Supabase secrets

### Фронтенд — переписанные компоненты
- `AuthContext.jsx` — Supabase Auth ✅
- `supabaseClient.js` — создан ✅
- `Login.jsx` — Google OAuth ✅
- `App.jsx` — роутинг обновлён ✅
- `Trips.jsx` — коллекция трипов ✅
- `ManualPlanner.jsx` — ручной планировщик ✅
- `NotificationsBell.jsx` — уведомления ✅
- `AppHeader.jsx`, `UserMenu.jsx` — хедер ✅
- `LandingPage.jsx` — лендинг ✅
- `AdminHome.jsx`, `AdminNotifications.jsx` — страницы admin ✅

### Дизайн `/ui`
`src/pages/redesign/` — 18 экранов (ScreenTimeline, ScreenBudget, ScreenCalendar, ScreenChat, ScreenHotels, ScreenMap, ScreenDocs, ScreenMembers, ScreenSettings, ScreenCollection, ScreenAccount, ScreenInbox, ScreenPro, ScreenAiPlanner, ScreenAI, ScreenForms, ScreenPublic, ScreenSystem). Источник: `Triplanio App 2/`. Нужна синхронизация с последней версией дизайна.

### ✅ Фаза 1 — Edge Functions: 26/26 ЗАДЕПЛОЕНО

| Группа | Функция | ID | verify_jwt |
|--------|---------|-----|------------|
| Участники | getTripDetails | 2462510d | false |
| | inviteTripMember | 7f24ae02 | true |
| | respondTripInvite | 7e322360 | true |
| | removeTripMember | 0bde8c0d | true |
| | updateTripMemberRole | bcdde72d | true |
| | resolveProfiles | 055ec2e3 | true |
| | resendTripInvite | f015f845 | true |
| Stripe | getUserPlan | d6837bbe | true |
| | getStripePrices | 1c97fed5 | true |
| | createStripeCheckout | 29c9e4b4 | true |
| | createBillingPortal | 943c1307 | true |
| | stripe-webhook | 772e404e | false |
| Telegram | telegramWebhook | 1a5b7d18 | false |
| | telegramGetIntegration | fc24e540 | true |
| | telegramSetActive | c5b8b67e | true |
| | telegramGetBotInfo | 0805fde5 | true |
| | telegramGetWebhookInfo | a9299e8f | true |
| | telegramStartLink | 9bb694a4 | true |
| Утилиты | triplanioAiReply | f5601a64 | false |
| | ensureShareToken | c5759b24 | true |
| | placesAutocomplete | 038713ae | true |
| | seedTripBudget | c7b0371c | false |
| | syncTripExpense | 662f26ea | false |
| | copyTrip | 72f64407 | true |
| | deleteMyAccount | d0823c42 | true |
| | sendTripReminders | 51c6699e | true |

**Отложено (низкий приоритет):**
- `exportTripPdf` — jsPDF + кастомный шрифт, добавим после запуска
- `backfillTripBudget` — разовая admin-миграция, нужна только при переносе данных

---

## ⏳ Что нужно от Pavel

### Env-переменные (добавить в Supabase → Secrets, если ещё нет)

| Переменная | Для чего |
|---|---|
| `GOOGLE_MAPS_API_KEY` | placesAutocomplete |
| `TRIPLANIO_AI_CALLBACK_SECRET` | triplanioAiReply (любая строка-секрет) |
| `ADMIN_EMAILS` | sendTripReminders, telegramGetWebhookInfo |
| `STRIPE_TEST_ORIGIN` | stripe-webhook (origin тестового окружения) |

Telegram/Stripe/Supabase ключи — если уже добавлены ранее, менять не нужно.

### Cron для sendTripReminders
Запускать каждые 15 минут с admin JWT (n8n / pg_cron / любой scheduler).

---

## ❌ Что ещё не сделано

### Фаза 1б — Дизайн /ui
Синхронизировать `src/pages/redesign/` с последней версией `Triplanio App 2/js/screens/`. Должна быть завершена до Фазы 2.

### Фаза 2 — Wiring фронтенда (~49 компонентов)
Все основные компоненты по-прежнему используют `base44Client`. Нужно переключить каждый на вызовы Supabase Edge Functions:

- **Страницы:** TripView, TripBudget, TripSettings, AiTripPlanner, PublicTrip, Settings
- **Диалоги:** HotelDialog, TransferDialog, ActivityDialog, ServiceDialog, CarRentalDialog, CityVisitDialog, TripDocumentDialog, InviteMemberDialog, ShareTripDialog, ExpenseDialog, FxOverridesDialog и др.
- **Компоненты:** TimelineView, MapView, CalendarView, TripChatTab, TripMembersBar, TelegramAssistantPanel, UpgradePlanDialog, TripBudgetCard и др.
- **Либы:** `chat.js`, `useTripAccess.js`, `useUserProfiles.js`, `fx.js`, `timezone-resolver.js`, `partnerTracking.js`

Порядок: Trips → TripView/Timeline → Hotels/Transfers/Activities → Budget → Chat → Settings → Members → Admin

### Фаза 3 — Realtime чат
`src/lib/chat.js` использует base44 realtime. Заменить на `supabase.channel()` / Postgres Changes.

### Фаза 4 — Внешние интеграции
- Stripe webhook URL → новый (`/functions/v1/stripe-webhook`), обновить `STRIPE_WEBHOOK_SECRET` в Stripe Dashboard
- Telegram webhook → переключить на `telegramSetWebhook` с новым URL
- Планировщик `sendTripReminders` → n8n или pg_cron

### Фаза 5 — Миграция данных
Экспорт из base44 → трансформация ID (string → UUID) → импорт в Supabase prod. Все таблицы сейчас пустые.

### Фаза 6 — Production switch
1. Подключить `triplanio.com/trips` к Vercel
2. Тест на dev
3. DNS switch
4. Выключить base44

---

## ⚠️ Проблема безопасности (не исправлена)

**`n8n_chat_histories`** — таблица **без RLS** (276 строк). Любой anon-ключ может читать/изменять данные.

```sql
ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;
```

---

## Итоговая оценка готовности

| Компонент | Статус | Готовность |
|-----------|--------|-----------|
| Схема БД и RLS | ✅ готово | 100% |
| Аутентификация (Supabase Auth) | ✅ готово | 100% |
| Edge Functions (серверная логика) | ✅ готово | 95%* |
| Фронтенд — каркас и роутинг | ✅ готово | 80% |
| Дизайн-система `/ui` | ⏳ в работе | 90% |
| Фронтенд — компоненты (данные) | ❌ не начато | ~10% |
| Realtime чат | ❌ не начато | 0% |
| Stripe / Telegram (webhook URLs) | ❌ не переключено | 0% |
| Миграция данных | ❌ не начато | 0% |

*95% — задеплоено 26 из 28 функций (отложены exportTripPdf и backfillTripBudget)

**Общая готовность к запуску: ~45%.**  
Инфраструктура и весь серверный слой готовы. Главный блокер — переключение фронтенда (Фаза 2).
