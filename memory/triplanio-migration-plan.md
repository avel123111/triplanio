---
name: triplanio-migration-plan
description: "Полный план миграции Triplanio с Base44 на Supabase+Vercel — последовательность фаз, статус на 2026-05-27"
metadata: 
  node_type: memory
  type: project
  originSessionId: bfbfc5eb-6546-42a9-afc8-afb0f8bca618
---

# Triplanio: план миграции Base44 → Supabase + Vercel
_Обновлён: 2026-05-27_

---

## Ключевые договорённости

- **Домен**: `triplanio.com/trips` (НЕ app.triplanio.com)
- **Репо**: `avel123111/triplanio`, branch `main`
- **Vercel проект**: `prj_KFPb5dTc91gzk1OQfPgx4Kvg94Sf`
- **Supabase prod**: `tizscxrpuopobgcxbekf` (eu-west-1)
- **Дизайн**: `triplanio_new/src/pages/redesign/` + папка `Triplanio App 2`
- **Правило**: перед любым изменением — смотреть в base44 коннектор + репо + схему Supabase

---

## ФАЗА 1 — Edge Functions ✅ ЗАВЕРШЕНА

26 функций задеплоены в Supabase prod, все ACTIVE.
Подробная таблица: см. `triplanio-status.md`.

Отложено (после запуска):
- `exportTripPdf` — jsPDF + TTF, сложная
- `backfillTripBudget` — разовая admin-миграция

---

## ФАЗА 1б — Дизайн /ui ✅ ЗАВЕРШЕНА

Все 18 `Screen*.jsx` в `src/pages/redesign/` синхронизированы с `Triplanio App 2`.

---

## ФАЗА 2 — Wiring (основной фронтенд)

### ✅ Сделано

| Компонент | Статус |
|---|---|
| `Trips.jsx` — список трипов | ✅ Supabase |
| `ManualPlanner.jsx` — создание трипа | ✅ Supabase |
| `TripView.jsx` — шелл + лензы | ✅ Supabase |
| `TimelineLens` — хронология | ✅ Supabase + edit mode |
| `BudgetLens` | ✅ Supabase |
| `MembersLens` | ✅ Supabase |
| `HotelsLens` | ✅ Supabase |
| `DocsLens` + Supabase Storage | ✅ Supabase |
| `SettingsLens` | ✅ Supabase |
| `AILens` | ✅ Supabase |
| `ChatLens` (polling) | ✅ Supabase (polling, не realtime) |
| `CalendarLens` | ✅ Supabase |
| `Login.jsx` + Google/Apple OAuth | ✅ Supabase Auth |
| `AuthContext.jsx` — INITIAL_SESSION fix | ✅ Исправлен |
| CSS FOUC + dark mode selector | ✅ Исправлен |

---

### ❌ Остаток Фазы 2 — компоненты на `base44.functions`

**26 файлов** всё ещё вызывают `base44.functions.invoke` / `base44.auth` / `base44.db`.
Нужно переключить каждый на `supabase.functions.invoke` (или прямые Supabase запросы).

#### Диалоги / компоненты (используются в основном флоу)

| Файл | base44 вызовы | Приоритет |
|---|---|---|
| `components/subscriptions/UpgradePlanDialog.jsx` | `getStripePrices`, `createStripeCheckout`, `createBillingPortal` | 🔴 высокий |
| `components/subscriptions/TripLimitDialog.jsx` | `getActiveTrips` | 🔴 высокий |
| `components/transfers/TransferDialog.jsx` | `checkSubscriptionStatus` | 🔴 высокий |
| `components/hotels/HotelDialog.jsx` | `checkSubscriptionStatus` | 🔴 высокий |
| `components/members/InviteMemberDialog.jsx` | `inviteTripMember` | 🔴 высокий |
| `components/members/TripMembersBar.jsx` | `removeTripMember`, `updateTripMemberRole`, `resendTripInvite` | 🔴 высокий |
| `components/members/PromoteOfflineDialog.jsx` | `inviteTripMember` | 🟡 средний |
| `components/settings/TelegramAssistantPanel.jsx` | `telegramGetIntegration`, `telegramStartLink`, `telegramSetActive`, `telegramDisconnect` | 🟡 средний |
| `components/trips/ShareTripDialog.jsx` | `ensureShareToken` | 🟡 средний |
| `components/trips/TripMembersCard.jsx` | `removeTripMember`, `updateTripMemberRole`, `resendTripInvite` | 🟡 средний |
| `components/trips/TripCollabBar.jsx` | `removeTripMember`, `updateTripMemberRole`, `resendTripInvite` | 🟡 средний |
| `components/common/AddressAutocomplete.jsx` | `placesAutocomplete` | 🔴 высокий (используется везде) |
| `components/views/MapView.jsx` | `getMapsApiKey` | 🟡 средний |
| `components/UserNotRegisteredError.jsx` | `base44.auth.logout()` | 🟡 средний |
| `components/chat/TripChatTab.jsx` | base44 realtime | 🟡 средний |
| `lib/useUserProfiles.js` | `resolveProfiles` | 🔴 высокий (используется везде) |
| `lib/fx.js` | `getFxRates` | 🟡 средний |
| `lib/timezone-resolver.js` | `placesAutocomplete` | 🟡 средний |
| `lib/i18n/I18nContext.jsx` | base44 locale | 🔴 высокий |
| `lib/PageNotFound.jsx` | base44 | 🟢 низкий |

#### Страницы

| Файл | Статус | Приоритет |
|---|---|---|
| `pages/Settings.jsx` | base44 функции | 🔴 высокий |
| `pages/TripSettings.jsx` | base44 функции | 🟡 средний |
| `pages/AiTripPlanner.jsx` | base44 функции | 🟡 средний |
| `pages/PublicTrip.jsx` | base44 функции | 🟡 средний |
| `pages/admin/AdminHome.jsx` | base44 | 🟢 низкий |
| `pages/admin/Notifications.jsx` | base44 | 🟢 низкий |

---

### ❌ Остаток Фазы 2 — функциональные пробелы

| Что | Проблема | Приоритет |
|---|---|---|
| **Клик на события в хронологии** | `StreamEventRow onClick={() => {}}` — ничего не открывает. Нужно открывать `HotelViewDialog`, `TransferViewDialog`, `ActivityViewDialog`. | 🔴 высокий |
| **MapLens** | Показывает `LensStub`, не реализован. Нужен `MapView` с Leaflet/Google Maps + маркеры городов. | 🟡 средний |
| **CityHero: редактировать визит** | `onEditVisitNotes` пробрасывается в `TimelineLens`, но в `CityHero` нет кнопки чтобы его вызвать. | 🟡 средний |
| **Удаление города/визита в edit mode** | В base44 есть `onDeleteVisit`. В нашем edit mode кнопка удаления не добавлена. | 🟡 средний |

---

## ФАЗА 3 — Realtime чат ❌

`ChatLens` сейчас работает на polling (refetchInterval). Нужно переключить на Supabase Realtime Channels.

Файл: `src/lib/chat.js` (если есть) или прямо в `ChatLens.jsx`.

---

## ФАЗА 4 — Внешние интеграции ❌

| Интеграция | Что нужно |
|---|---|
| **Stripe webhook** | Изменить URL в Stripe Dashboard → `https://tizscxrpuopobgcxbekf.supabase.co/functions/v1/stripe-webhook`. Добавить `STRIPE_WEBHOOK_SECRET` в Supabase secrets. |
| **Telegram webhook** | Вызвать `telegramSetWebhook` с URL новой функции. |
| **sendTripReminders cron** | Настроить pg_cron или n8n на вызов каждые 15 минут с admin JWT. |
| **Google Maps API Key** | Добавить `GOOGLE_MAPS_API_KEY` в Supabase secrets (нужен для placesAutocomplete + MapView). |

---

## ФАЗА 5 — Миграция данных ❌

1. Экспорт всех данных из base44 (trips, visits, hotels, transfers, activities, members, budgets, documents, messages)
2. Трансформация ID: base44 string → UUID
3. Маппинг `created_by`: email → Supabase auth user id
4. Импорт в Supabase prod через `backfillTripBudget` + скрипты
5. Проверка целостности (RLS, foreign keys)

Применять только непосредственно перед DNS-переключением.

---

## ФАЗА 6 — Production switch ❌

1. Финальное тестирование на Vercel preview
2. Подключить `triplanio.com` к Vercel (домен уже есть на лендинге)
3. Настроить routing: `/trips/*` → новое приложение
4. DNS переключение
5. Мониторинг ошибок (Vercel logs, Supabase logs)
6. Выключить base44 (после подтверждения что всё работает)

---

## Env-переменные которые нужны в Supabase Secrets

| Переменная | Для чего | Статус |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | placesAutocomplete, MapView | ❓ |
| `TRIPLANIO_AI_CALLBACK_SECRET` | triplanioAiReply | ❓ |
| `ADMIN_EMAILS` | sendTripReminders, admin functions | ❓ |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | ❓ |
| `STRIPE_SECRET_KEY` | Stripe functions | ❓ |
| `TELEGRAM_BOT_TOKEN` | Telegram functions | ❓ |

---

## Общий прогресс

```
Фаза 1  (Edge Functions)    ████████████████████ 100%
Фаза 1б (Дизайн /ui)       ████████████████████ 100%
Фаза 2  (Wiring фронтенд)  █████████████░░░░░░░  65%
Фаза 3  (Realtime)         ░░░░░░░░░░░░░░░░░░░░   0%
Фаза 4  (Webhooks/cron)    ░░░░░░░░░░░░░░░░░░░░   0%
Фаза 5  (Данные)           ░░░░░░░░░░░░░░░░░░░░   0%
Фаза 6  (DNS switch)       ░░░░░░░░░░░░░░░░░░░░   0%
```

**Итого**: ~38% от полного запуска. Главный блокер перед запуском — завершить Фазу 2 (26 файлов на base44) и настроить Фазу 4 (webhooks).
