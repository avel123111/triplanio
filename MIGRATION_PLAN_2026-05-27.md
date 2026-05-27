# Triplanio — план миграции до прод-запуска (ревизия 2, 2026-05-27)
**Цель:** перенести ВСЮ логику base44 (прод) на новые экраны (Supabase + Vercel) и запустить на triplanio.com.

## Definition of Done (строгие критерии — действуют для всего)
Фича считается готовой ТОЛЬКО если выполнены ОБА:
1. **Визуал** — элемент/экран/диалог/попап взят из нового дизайна (`Triplanio App 2` / дизайн-система `src/design/index.jsx`: `ModalHost`, `Dialog`, `Btn`, `Badge`, `Card`, `Avatar`, `EmptyState`, `Field`…). Ни одного элемента из старого base44/shadcn-дизайна (`@/components/ui/dialog` и т.п.) не остаётся.
2. **Функционал** — полностью повторяет логику той же фичи в base44 (валидации, правила, side-effects).

## Архитектурные заметки
- **Edge Functions = порты base44-функций**, не параллельные. base44 выключаем, поэтому каждая его серверная функция должна жить на Supabase.
- **`addOfflineTripMember`** — в base44 такой функции НЕТ; офлайн-участник там пишется прямо из браузера `TripMember.create({user_email:null,status:'offline',role:'viewer'})` (RLS открыт). Наша Supabase-функция — серверно-защищённый аналог (та же строка + проверка прав). Это допустимое ужесточение; фронт MembersLens уже её зовёт.
- **Модалки нового дизайна:** `ModalHost` (в `design/index.jsx`) + `window.__openModal(<Dialog…/>)` / `window.__closeModal()`. Линзы Budget/Docs/Members/Settings/Chat уже так работают. Все старые shadcn-диалоги переводим на этот паттерн.
- **Формы событий** в макете `Triplanio App 2` сделаны как ОТДЕЛЬНЫЕ экраны (`hotel-form`/`transfer-form`/`activity-form`), а просмотр — единый `EventModal`. Реализуем как модалки нового дизайна (Dialog), сохраняя визуальную структуру макета.

---

## WS-A — Перевод всех диалогов на новый дизайн (визуальный долг; обязательно по DoD)
Сейчас на старом shadcn-дизайне (26 файлов). Сгруппировано:
- **Просмотр события** → единый `EventModal` (новый дизайн, `dialogs.jsx:7`): `HotelViewDialog`, `TransferViewDialog`, `ActivityViewDialog`, `CarRentalViewDialog`, `ServiceViewDialog`, `TripDocumentViewDialog`.
- **Создание/редактирование** (форма нового дизайна): `HotelDialog`, `TransferDialog`, `ActivityDialog`, `CityVisitDialog`, `ServiceDialog`, `CarRentalDialog`, `BookHotelDialog`, `BookingChoiceDialog` (→ `ForkPartner`), `TripDocumentDialog`.
- **Бюджет:** `ExpenseDialog`, `CategoryNameDialog`, `FxOverridesDialog` (логика уже в BudgetLens на новом дизайне — эти standalone-диалоги легаси, заменить/удалить).
- **Участники:** `InviteMemberDialog`, `PromoteOfflineDialog` → новый `InviteDialog`/`ConvertOfflineDialog` (логика уже частично в MembersLens).
- **Pro:** `UpgradePlanDialog`, `TripLimitDialog`, `WelcomeToProDialog` → `ScreenPro` / `FreeLimitDialog` / `ProLockedDialog` / `PaymentSuccess/FailDialog`.
- **Трипы:** `NewTripModal`, `TripFormDialog`, `ShareTripDialog` → `NewTripDialog` / `ShareDialog` нового дизайна.

Данные у Hotel/Transfer/Activity/City/Service-диалогов уже на Supabase (сделано) — но визуал старый ⇒ по DoD НЕ done, пока не перерисованы.

## WS-B — Точечные баги/логика (подтверждены сверкой с base44)
- **B1. Правило «нет переезда».** Привести к логике base44 `ReadOnlyTimelineView.jsx`: пропускать `start→city1` (`prev.kind==='start' && v.kind!=='end'`), НЕ предупреждать перед `start`, показывать `cityN→end` и `start→end`. Сейчас у нас инвертировано (предупреждает на start→city1, не показывает на cityN→финиш).
- **B2. i18n / ru по умолчанию.** В base44 `detectInitialLang`: `user.language → localStorage → navigator → 'ru'`; `t()` фолбэчит на ru при отсутствии ключа. Чинить: (а) инициализировать язык из `user` после авторизации (сейчас mount берёт null), (б) проверить полноту локалей en/es (недостающие ключи молча дают ru), (в) переключатель языка живёт в настройках аккаунта — нужен экран аккаунта (WS-D). 
- **B3. Read-only ссылка.** Шеринг в `TripView` строит `/trip/:id` (приватный) ⇒ без логина редиректит на лендинг. Чинить: `ShareDialog` зовёт `ensureShareToken`, строит `/public/trip/:id?t=<share_token>` (публичный роут уже байпасит auth, токен в `?t=`). Проверить, что роут `/public/trip/:id` реально открывается без логина.
- **B4. Pro/Free UI.** Добавить по новому дизайну: PRO-бейдж в шапке (`app.jsx:101/119`), плашку «Free-трип» в левом меню трипа (`FreeTripUpgradeCard`, `app.jsx:155`, условие `owner && !pro && !is_pro_trip`), бейджи Pro-lock на линзах. **Лимит трипов:** free = максимум 1 активный трип; PRO снимает лимит — сейчас баг: PRO не даёт создать трип (проверить, что `isPro` из checkSubscriptionStatus реально пробрасывается и `!isPro && activeCount>=1`). «Активный» = нет дат-визитов ИЛИ max(end)>=сегодня(UTC).
- **B5. «Кто едет» / участники.** Повторить логику base44 `TripMembersCard`: синтетическая строка владельца (`created_by`), как аватары показывать `active`+`offline`, `pending` — отдельным счётчиком «+N pending». Имя: `profile.full_name || user_full_name || user_email`. Новый участник создаётся `pending` → виден в счётчике pending, не как аватар, пока не принял. **Баг «не появляется»:** после добавления участника инвалидировать `TRIP_CONTENT_KEY` (getTripDetails), и корректно отображать offline (`user_email:null`).
- **B6. Колокольчик.** По новому дизайну bell открывает дропдаун (`BellDropdown`, popover), НЕ навигирует. Сейчас ведёт на битый `/inbox`. Чинить: bell → дропдаун уведомлений; «смотреть все» → экран `/inbox` (ScreenInbox).
- **B7. Google Maps.** Ошибка при ручном создании трипа (мини-карта) и в Map-линзе. Нужен `GOOGLE_MAPS_API_KEY` (секрет, WS-E) + корректный лоадер Maps (через `getMapsApiKey`), либо Leaflet-фолбэк. Реализовать Map-линзу (сейчас LensStub).

## WS-C — Недостающие/непроверенные edge-функции
Портировать на Supabase (нет в репо/деплое):
- **planTripWithAi** — синхронный LLM (base44: `InvokeLLM`, gemini, строгий JSON-schema драфта). Нужна наша AI-инфра.
- **callTriplanioAi** — триггер ИИ-ответа в групповом чате (base44: подпись JWT → n8n webhook; ответ приходит в `triplanioAiReply`). Без него «@Triplanio» в чате молчит.
- **exportTripPdf** (jsPDF), **getTripByTelegramChatId**, **telegramSetWebhook** (admin), **telegramGetWebhookInfo** (есть в деплое, нет исходника в репо — добавить), **createTestCheckout** (admin), **backfillTripBudget** (admin, разовая), **getUserPlan** (в деплое, исходника в репо нет — добавить).
- **Бюджет авто-синк:** base44 авто-зеркалит расходы из отелей/переездов/активностей/сервисов через `syncTripExpense` (вызывался автоматизациями на create/update). На Supabase функция задеплоена, но **не триггерится** — нужны БД-триггеры (или вызовы из фронта) на изменение hotel_stays/transfers/activities/trip_services. Иначе бюджет не отражает брони автоматически.

## WS-D — Экраны на новом дизайне + логика base44 (ещё на base44)
- **/settings (аккаунт)** → `ScreenAccount`: план (getUserPlan), billing portal, аватар, **язык (переключатель i18n)**, удаление аккаунта, нотификации.
- **/plan-trip-ai** → `ScreenAiPlanner` + planTripWithAi (WS-C).
- **/inbox** → `ScreenInbox` (+ роут; bell-дропдаун из B6).
- **/public map-вкладка** — зависит от Maps (B7).
- **admin** (/admin, /admin/notifications).
- **Легаси-дубли** `/trip/:id/budget`, `/trip/:id/settings` — удалить/редирект на линзы.
- **Карточка трипа в списке** — действия копировать(copyTrip)/удалить/поделиться/контекст-меню (в новом списке отсутствуют).
- **Сервисы** — подключить ServiceDialog/CarRentalDialog к виджету «Сервисы» в TripView (сейчас кнопки без действий).
- **Чат:** ИИ-меншн (callTriplanioAi), непрочитанные (chat_reads).
- **Хронология:** удаление города/визита (каскад по FK).
- **Календарь:** drag-перенос (dragEvents.js).
- **AI-загрузка брони** HotelAiUpload/TransferAiUpload (InvokeLLM → наша AI-инфра).

## WS-E — Инфраструктура и данные (P5)
- Секреты Supabase: `GOOGLE_MAPS_API_KEY`, `TRIPLANIO_AI_CALLBACK_SECRET`, `ADMIN_EMAILS`, Stripe/Telegram ключи.
- **Включить Apple-провайдер** в Supabase Auth (ошибка «provider is not enabled»), или убрать кнопку Apple до настройки.
- Stripe webhook URL → `…/functions/v1/stripe-webhook` + `STRIPE_WEBHOOK_SECRET`.
- Telegram webhook → `telegramSetWebhook`.
- `sendTripReminders` cron (каждые 15 мин, admin).
- Миграция данных base44 → Supabase (ID→UUID, created_by→email/uid).

## WS-F — Безопасность и прод-свитч (P6)
- RLS на `n8n_chat_histories`; удалить `testTable`, `n8n_chat_messages`.
- Удалить `src/api/base44Client.js`, base44-плагин в `vite.config.js`, переименовать пакет — после переезда всех файлов.
- Финальный тест по ролям (owner/admin/viewer/offline) и Pro/Free.
- Роутинг triplanio.com/trips на новый билд → выключить base44.

---

## Рекомендованный порядок
WS-B (баги, дают рабочий продукт) → WS-A (дизайн диалогов, по DoD) → WS-C (функции, особенно syncTripExpense-триггеры и AI) → WS-D (экраны) → WS-E (инфра+данные) → WS-F (свитч).
