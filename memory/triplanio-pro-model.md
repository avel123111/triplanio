---
name: triplanio-pro-model
description: "КАНОНИЧЕСКАЯ модель Pro Triplanio — тарифы, что кому когда доступно, правила совместных трипов. Источник истины."
metadata: 
  node_type: memory
  type: project
  originSessionId: b3f57dcb-0e3d-4ac9-971d-65614dc54ab6
---

# Triplanio: модель Pro и тарифы (источник истины)
_Согласовано с Pavel 2026-05-29/30. При расхождении кода с этим документом — прав документ (это целевая модель), кроме явно отложенного._

## Тарифы (3 платных плана + Free)
- **Free** — без подписки. Лимит: **1 активный трип**. «Активный» = трип не полностью в прошлом (последний день ≥ сегодня); прошедшие трипы слот освобождают. Доступны все базовые линзы; pro-фичи закрыты.
- **pro_monthly** — рекуррентная подписка (месяц). Аккаунт-уровень: открывает pro во ВСЕХ трипах юзера + безлимит активных трипов.
- **pro_yearly** — то же, годовая (дешевле в пересчёте).
- **pro_trip** — разовая покупка Pro для ОДНОГО конкретного трипа (`trips.is_pro_trip=true`), бессрочно, без подписки.

Цены берутся из Stripe live (`getStripePrices`, по `default_price` продукта). НЕ хардкодить. ⚠️ У live-продуктов pro_trip/pro_yearly default_price не задан + засветились тестовые цены (€0.05) → стрельнуло ошибкой checkout; нужно задать default_price и архивировать тестовые. Stripe-продукты: pro_trip `prod_UYfZZsZnknkxDj`, pro_monthly `prod_UYfZf8WvFNE3cI`, pro_yearly `prod_UYfZBYzOWrKiLu`.

## Две оси Pro
1. **Аккаунт-подписка** — `users.subscription_status='pro'` + `subscription_end_date` в будущем (pro_monthly/pro_yearly). Снимает лимит трипов и даёт pro во всех СВОИХ трипах.
2. **Pro-трип** — `trips.is_pro_trip=true` (pro_trip). Открывает pro-фичи в этом одном трипе ВСЕМ его участникам.

## ★ПРОДУКТОВОЕ РЕШЕНИЕ: системные траты бюджета пишутся ВСЕГДА (Pavel 2026-06-21)
Бюджет — Pro-аддон ТОЛЬКО на уровне UI/линзы. Но **системные расходы (события и сервисы — events/services) записываются в бюджет-таблицы (trip_budgets/budget_expenses/budget_categories) ВСЕГДА**, независимо от Pro-статуса трипа и включённости аддона. Это by design. RLS на этих таблицах (`is_trip_participant`, ALL) НЕ ужесточать под аддон/Pro — это сломает системные траты. **По бюджет-гейтингу ничего делать НЕ надо** (бывший T8 аудита — ОТМЕНЁН). Аналогично подтверждено: **AI-планировщик (planTripWithAi) — НЕ Pro-фича**, гейт только по лимиту трипов.

## Что является Pro-фичей (= PRO_ONLY аддоны)
PRO_ONLY = `budget`, `telegram_assistant`, `chat`. Плюс **ИИ-распознавание брони** (hotel/transfer парсер) — pro.
**НЕ Pro:** `calendar`, `docs`, `hotels_selection`, карта, базовый таймлайн. Аддона `ai` НЕ существует (личный ИИ-ассистент удалён).
**ИИ-планировщик трипа** (`planTripWithAi`) — НЕ pro-фича: гейт как у ручного создания, только по лимиту трипов.

## Когда что доступно (матрица)
- Базовые линзы (таймлайн, карта, документы, календарь) — всем всегда.
- Pro-фичи (бюджет-разбивка, чат+@assistant, telegram, ИИ-парсер брони) — только если **трип про**.
- Создание 2+ активного трипа — только при активной подписке.

## СОВМЕСТНЫЕ ТРИПЫ — ключевые правила (owner-based)
- **Трип «про» ⇔ у ВЛАДЕЛЬЦА (`trips.created_by`) активная подписка ИЛИ `is_pro_trip=true`.** Тогда pro-фичи доступны ВСЕМ активным участникам этого трипа.
- **Личная подписка участника НЕ открывает чужой трип.** Если трип free (владелец не про и не pro_trip) — участнику pro-фичи недоступны, даже если у него своя подписка.
- **Поднять трип до Pro может ТОЛЬКО владелец.** Участникам апгрейд НЕ предлагаем; вместо кассы — модалка `TripProInfoDialog` («Pro подключает владелец, обратитесь к нему»).
- Единственный корректный предикат на фронте — `checkSubscriptionStatus({tripId})` (owner-aware, отдаёт `isPro`+`isOwner`). НЕ использовать `isProActive(user)` (смотрящий) для in-trip гейтинга.
- Роли: owner / admin(=editor) / viewer — независимы от Pro. Доступ в Настройки — owner+admin; зрителю закрыт (и пункт меню, и guard внутри). Аддоны меняет владелец (админ — только на уже-про трипе).
- Оффлайн-участники подписки не имеют, на Pro не влияют. Копия трипа Pro не наследует (is_pro_trip=false).

## Решения сессии 2026-05-29/30 (см. ТЗ `triplanio_new/PRO_TZ_2026-05-29.md`)
1. Серверный лимит трипов в `create_trip` RPC + RLS (сейчас только клиент). Прямой вход на ИИ-планировщик при лимите = полноэкранный блокер, как у ручного (не модалка).
2. Owner-based гейтинг в TripView + единая модалка `TripProInfoDialog` для участников на всех точках входа в оплату (P1 сайдбар, P2 settings, P3 ИИ-парсер, P4 Pro.jsx).
3. Замки в Settings привести к PRO_ONLY (убрать pro у calendar, убрать пункт ai, docs не «скоро»).
4. Видимость pro-линз в меню = по аддону; чат: при выкл. аддоне скрыть и вкладку, и плавающий виджет.
5. Новый трип создаётся с выключенными pro-аддонами у всех.
6. Модалки оплаты: одна на успех + одна на неуспех (дизайны PaymentSuccessDialog/PaymentFailDialog из dialogs.jsx). Убрать дубль (WelcomeToProDialog vs PaymentSuccessDialog).
7. Обновить модалку лимита трипов (Variant D), старые A/B/C выпилить. Вызывать везде, где звался старый TripLimitDialog, кроме прямого входа на ИИ-планировщик (там экран).
8. Бюджет-виджет → клик: аддон вкл → линза; выкл → владельцу модалка «включите аддон» (в настройки), участнику — TripProInfoDialog.
9. Вебхук: обработка `charge.refunded`/`charge.dispute.created` → снять is_pro_trip (pro_trip) / перевести во free (подписка). От Pavel: включить отправку этих событий в Stripe (live+test).
10. `isProActive`: null end_date = НЕ про (выровнять с сервером). Удалить мёртвый `AiFeatureLock` + прочий мёртвый Pro-UI (ScreenPro, Settings.jsx, UserMenu).

## Открытые вопросы (ждём Pavel)
- Variant D модалки лимита: прислать код или строить по скриншоту (в dialogs.jsx нет, только A/B/C).
- Финальный текст `TripProInfoDialog`.
- Может ли админ (не владелец) менять аддоны на уже-про трипе; подтвердить полное закрытие настроек зрителю.
- Судьба `telegram`/`calendar` в списке фич настроек.

## Реализация (2026-05-30) — СДЕЛАНО (не закоммичено)
Изменённые файлы: `src/lib/subscription.js`, `src/components/common/TripProInfoDialog.jsx`(new), `src/pages/SettingsLens.jsx`, `src/pages/TripView.jsx`, `src/components/common/EventEditDialog.jsx`, `src/pages/Pro.jsx`, `supabase/functions/stripe-webhook/index.ts`, `supabase/migrations/0009_create_trip_free_limit.sql`(new).
- isProActive: null end_date = не про.
- TripProInfoDialog (модалка «обратись к владельцу»), повешена в SettingsLens / EventEditDialog / сайдбар TripView для не-владельцев.
- TripView: tripIsPro+isOwner из checkSubscriptionStatus({tripId}); account-pro только в шапке. Сайдбар: владелец→апгрейд, участник→инфо.
- isLensVisible + featuresFromTrip → дефолт OFF (новый трип без pro-фич). Чат-виджет уже завязан на аддон.
- SettingsLens FEATURES = budget/chat/telegram (pro), calendar (не pro), hotels (скоро); ai/docs убраны. Тоггл pro: владелец→касса, админ→инфо.
- Settings/Members скрыты у зрителя в меню + guard в TripView. Шевроны бюджет/участники только owner/admin; бюджет выкл→модалка «включить аддон»→настройки.
- Pro.jsx: pro_trip не показывается не-владельцу трипа (подписку купить можно).
- Вебхук (dev v5/prod v10): charge.refunded/charge.dispute.created → снять is_pro_trip / users free, статус refunded/disputed.
- create_trip RPC (dev+prod): free = 1 активный трип, иначе TRIP_LIMIT_REACHED.
Сборка фронта зелёная.

## Task 17 — СДЕЛАНО (2026-05-30)
- PaymentSuccessDialog/PaymentFailDialog редизайн по dialogs.jsx (X, чип тариф+цена в успехе, card_declined в неуспехе). Обработка stripe_status сведена в ОДНО место — Layout.jsx (один success + один fail на всё приложение). Дубли убраны из TripView.jsx и Trips.jsx. WelcomeToProDialog больше не используется (мёртвый).
- Цена в успехе: Layout тянет getUserPlan(subscriptionType) + getStripePrices; если цена есть — показывает «Pro Monthly · €9.99/мес», иначе только название.
- TripLimitDialog переписан в Variant D (hero + Free/Pro колонки + «Не сейчас»/«Посмотреть тарифы»→/pro?hidePerTrip=1). Используется в Trips.jsx (in-app «Новый трип»).
- ИИ-планировщик при лимите по прямой ссылке → полноэкранный блокер (как ManualPlanner), не модалка.
Сборка зелёная.

## ОСТАЛОСЬ
- RLS-бэкстоп на insert trips (опц.) — единственный путь create_trip уже покрыт серверным лимитом.
- Удалить мёртвый код через git rm: `AiFeatureLock.jsx`, `subscriptions/WelcomeToProDialog.jsx`, и (если не нужны) `ScreenPro.jsx`, `Settings.jsx`, `UserMenu.jsx`. Инструменты не могут unlink (mount).
- Неиспользуемые импорты после рефакторинга (TripLimitDialog в AiTripPlanner; Payment*/useSearchParams в Trips/TripView) — на сборку не влияют, можно подчистить.

## RLS таблицы trips = ТОЛЬКО владелец (важно)
`trips` UPDATE/DELETE RLS = `created_by = auth.uid()` (owner-only). Контентные таблицы (city_visits/hotel_stays/activities/transfers/trip_services/trip_documents/trip_budgets/budget_categories/budget_expenses) = `is_trip_participant(trip_id)` (участник пишет ок). Значит ЛЮБАЯ прямая клиентская запись в `trips` админом (не владельцем) молча проваливается (0 строк, без ошибки) → оптимистичный UI откатывается после refresh. Это был баг: тоггл аддона/сохранение названия-валюты/редактирование метаданных у админа не сохранялись.

## Фикс (2026-05-30, отдельный коммит после 3d14a57)
Edge-функция **`updateTripSettings`** (verify_jwt=true, задеплоена dev+prod): пишет в `trips` под service role, проверяя owner ИЛИ active admin; pro-гейт на включение pro-аддонов (budget/telegram_assistant/chat) — `PRO_REQUIRED` если трип не pro (is_pro_trip ИЛИ подписка владельца). Принимает `{tripId, fields(title/description/cover_*/notes), addons, main_currency}`, отдаёт 200 `{ok}` или `{ok:false, code:'FORBIDDEN'|'PRO_REQUIRED'}`.
Переведены на неё (вместо прямого trips.update): `SettingsLens.saveSettings`, `SettingsLens.toggleFeature` (PRO_REQUIRED→ProLocked/инфо), `TripFormDialog` (редактирование метаданных). `deleteTrip` остался owner-only (прямой delete).
Файлы коммита: `supabase/functions/updateTripSettings/index.ts`(new), `src/pages/SettingsLens.jsx`, `src/components/trips/TripFormDialog.jsx`.

## Данные трипа 49a1de05 (правка вручную в БД)
Владелец dddyakonova@gmail.com — Pro (до 2036), значит трип Pro через владельца. Милан имел start 06-10 12:00 (позже Мадрид 00:00) и сломанный конец (11:00<12:00) → падал ниже Мадрида + каскад «Милан→Канары». Исправлено в БД: Милан 06-10 00:00 → 06-10 23:59 (тот же start что у Мадрида, конец раньше → Милан выше). Код таймлайна был корректен — причина в данных.

## Отложено
- getTripDetails (verify_jwt=false → неавторизованный доступ к трипу) — закрыть позже (решение Pavel).
- Валидация дат города при сохранении (end≥start, без перекрытий) — чтобы такие данные не появлялись.
