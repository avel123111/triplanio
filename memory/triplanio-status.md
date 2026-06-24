---
name: triplanio-status
description: Актуальный статус миграции Triplanio — обновляется после каждой сессии
metadata: 
  node_type: memory
  type: project
  originSessionId: bfbfc5eb-6546-42a9-afc8-afb0f8bca618
---

# Triplanio: текущий статус миграции
_Последнее обновление: 2026-05-27 (аудит по факту, коннекторы + код)_

Полный отчёт: `triplanio_new/AUDIT_MIGRATION_2026-05-27.md`.
План работ до прода (которому следуем): `triplanio_new/MIGRATION_PLAN_2026-05-27.md` (фазы P0–P6).
**Общая готовность к полному запуску: ~40%.**

## СКОУП (важно, решение Pavel 2026-05-27)
Эталон — base44. Линзы трипа: timeline / map / calendar* / budget* / documents / chat* (звёздочка — гейт аддоном Trip.details.addons; budget/chat/telegram — Pro). Управление: members / settings / share.
**НЕ делаем:** отдельный «ИИ-чат» (AILens) и «выбор отелей» (HotelsLens) — их НЕТ в base44. ИИ живёт ВНУТРИ группового чата (@triplanio → triplanioAiReply). Аддон hotels_selection в конфиге есть, но экрана нет — пропускаем. P0 плана = удалить AILens/HotelsLens из нового приложения.

---

## Прогресс по плану (сессия 2026-05-27)
- **P0 ✅** AILens/HotelsLens удалены из TripView, сайдбар приведён к набору base44 (lenses: timeline/map/calendar/budget/docs/chat; mgmt: members/settings). Файлы AILens.jsx/HotelsLens.jsx осиротели (bash удалять не может — убрать вручную через git). Сборка зелёная.
- **P1 ядро ✅** Реально достижимые в новом флоу диалоги редактирования переведены на Supabase: CityVisitDialog, ActivityDialog, HotelDialog, TransferDialog (create/update) + удаления (ActivityList/HotelTimeline/TransferStrip) + ServiceDialog/CarRentalDialog. Плюс AddressAutocomplete и timezone-resolver → supabase.functions('placesAutocomplete'), DocumentsField → Supabase Storage (bucket 'documents', signed URL 10л). created_by = user.email. Сборка зелёная.
- Маппинг проверен: поля диалогов совпадают со схемой Supabase (transfers использует carrier/from_address/to_address — корректно). Рассинхрон ИМЁН только в TripView.buildEventStream (carrier_name/flight_number/origin_name/country_name) — это баг ЧТЕНИЯ хронологии, чинить в P4.2.
- checkSubscriptionStatus в Hotel/TransferDialog переведён на supabase.functions, но функция ещё НЕ задеплоена (P2) → пока graceful degrade (isPro=false).

## Аудит после правок Pavel (коммиты ScreenAccount/WS-B/«5 regressions»)
Сборка зелёная. Исправлено: колокольчик→дропдаун, PRO-бейдж в шапке, PRO обходит лимит трипов, /settings→ScreenAccount (Supabase: план/billing/удаление/аватар/язык), i18n синк из user, ContextSide учитывает offline.
**НЕ исправлено — починили НЕ те файлы:** (1) правило «нет переезда» — правка в легаси components/views/TimelineView.jsx, а используется TripView→TimelineLens (стр.643-656), там всё ещё нет пропуска start→city1; (2) share-ссылка — правка в standalone ShareTripDialog, а TripView юзает свой инлайновый ShareDialog (стр.829, всё ещё /trip/:id вместо /public/trip/:id?t=token).
**Всё ещё нет:** плашка Free-трип в новом сайдбаре; Apple-провайдер (конфиг Supabase); карта; 26 shadcn-диалогов (WS-A); /inbox-роут.
**Новое:** isPro нигде не проверяет subscription_end_date (истёкший pro = активный) — TripView/Trips/ManualPlanner; ContextSide не показывает pending-счётчик.

## Сессия 2026-05-27 (часть 3): P3/P4 частично
Детальный чеклист готовности по фичам: `triplanio_new/CHECKLIST_STATUS_2026-05-27.md`.
- **P4 сделано:** клик по событию хронологии → view/edit-диалог (через SourceViewLoader); фикс маппинга полей в buildEventStream (transfers carrier/booking_url/города из from/to_city_visit_id; hotels booking_url/booking_reference; CityHero country); кнопка «Изменить» город в edit-mode.
- **P3 сделано:** PublicTrip → supabase getPublicTrip.
- **P4/P3 НЕ сделано (ключевое):** удаление города/визита; Map lens (LensStub); аддон-тоглы в SettingsLens + гейтинг линз; Telegram в SettingsLens = UI-мок; виджет «Сервисы» не подключён к ServiceDialog; чат: unread + ИИ-автоответ; AI-загрузка брони (HotelAiUpload/TransferAiUpload на base44); страница аккаунта /settings; /plan-trip-ai + planTripWithAi (LLM, не задеплоена); /inbox (нет роута); admin; drag в календаре; действия карточки трипа в списке (copy/delete/share); легаси TripBudget/TripSettings.
- Сборка зелёная. Не закоммичено.

## Сессия 2026-05-27 (часть 2): P1.8 либы + P1.7 чат + P2 функции
- **P2 ✅ (7 из 8 задеплоены ACTIVE):** checkSubscriptionStatus, getActiveTrips, getMapsApiKey, getFxRates, telegramDisconnect (verify_jwt=true), getPublicTrip (verify_jwt=false), addOfflineTripMember. Все самодостаточные (инлайн CORS+admin client, без _shared). Исходники в supabase/functions/<name>/index.ts. **Отложена planTripWithAi** — тянет LLM-генерацию, делать со страницей ИИ-планировщика (P3).
- **P1.8 либы ✅:** fx.js, useUserProfiles, useTripAccess, partnerTracking, i18n(язык→users.update), PageNotFound(auth.getUser), SourceViewLoader(getRow→supabase), UserNotRegisteredError(signOut). Плюс UpgradePlanDialog/TripLimitDialog/TelegramAssistantPanel → supabase.functions (функции теперь есть).
- **P1.7 чат ✅:** ChatLens перемаплен с несуществующей trip_messages на chat_messages (колонки text/user_full_name/user_email/created_by), realtime-канал на chat_messages, isAi по TRIPLANIO_BOT_EMAIL='info@triplanio.com'. **Добавил chat_messages в публикацию supabase_realtime** (без этого live не работал). Убрал ссылку на удалённую линзу 'ai'.
- Конвенция вызова функций: supabase.functions.invoke('fn', { body: {...} }).
- Сборка зелёная на каждом шаге. НЕ закоммичено/не запушено.
- **Follow-up (не блокеры):** AI-автоответ в чате (@Triplanio → triplanioAiReply) не подключён — нужен контракт функции; обработка кодов ошибок Stripe в UpgradePlanDialog (error.context вместо error.response.data) деградирует до общего сообщения; AI-загрузка брони (HotelAiUpload/TransferAiUpload, InvokeLLM) ещё на base44.

## Остаток P1 (исторический — теперь закрыт, см. выше)
Ещё на base44: lib/chat.js(→P1.7), lib/fx.js(getFxRates→P2), useUserProfiles(resolveProfiles—есть), useTripAccess, i18n язык(updateMe), partnerTracking, SourceViewLoader, PageNotFound, app-params, brand; HotelAiUpload/TransferAiUpload(InvokeLLM→P2/P4); UpgradePlanDialog/TripLimitDialog(→P3.5/P2); виджет «Сервисы» в TripView НЕ подключён к ServiceDialog(→P4). Легаси (мёртвое, на base44, чистить в P3.7): TripBudget, TripSettings, TripFormDialog, TripHeader, TripMembersBar/Card, TripCollabBar, TripServicesCard/Row, TripBudgetCard, TripPageHeader, ShareTripDialog, TripDocumentDialog/Tab, CalendarWeekView, InviteMemberDialog, PromoteOfflineDialog.
Изменения НЕ закоммичены/не запушены (push на main = автодеплой на triplanio.com).

## Главный вывод (изначальный)
Чтение в новых экранах переведено на Supabase; CRUD-запись была на base44. Сессией 2026-05-27 переведено ядро редактирования трипа. `TripView` читает из нового бэка (getTripDetails); диалоги хронологии теперь тоже пишут в Supabase.

## Бэкенд (Supabase prod tizscxrpuopobgcxbekf)
- 26 Edge Functions ACTIVE ✅ (проверено коннектором).
- ❌ НЕ написаны/не задеплоены, но вызываются фронтом: checkSubscriptionStatus, getActiveTrips, getFxRates, getMapsApiKey, getPublicTrip, planTripWithAi, telegramDisconnect, addOfflineTripMember. Отложены: exportTripPdf, backfillTripBudget.
- Схема 22 таблицы есть, RLS вкл. **Контентные таблицы пусты** (hotel_stays/activities/transfers/trip_members/chat_messages = 0). Данные НЕ мигрированы. Есть тестовые: trips=4, city_visits=14, users=6.
- ⚠️ n8n_chat_histories — RLS OFF (276 строк). Мусор: testTable, n8n_chat_messages.

## Vercel (проект triplanio_app)
- Последний prod-деплой READY, автодеплой с main. Домены triplanio.com + www уже привязаны (но реальный прод для юзеров — base44 на app.triplanio.com).

## Готовность линз трипа
- 🟢 Budget, Docs (Storage), AI, Calendar(read-only) — на Supabase.
- 🟡 Members (зовёт несуществующую addOfflineTripMember), Settings (часть тоглов «Скоро»).
- 🟠 Хронология: читается, но edit-диалоги пишут в base44; клик по событию `onClick={()=>{}}` пустой (нет view-диалогов).
- 🔴 Чат: realtime реализован, но обращается к таблице `trip_messages`, которой НЕТ в схеме (есть chat_messages) → сломан.
- 🔴 Отели: layout-only мок. Карта: LensStub (не реализована).

## Легаси на base44 (в роутинге, дубли линз)
/trip/:id/budget (TripBudget 16 вызовов), /trip/:id/settings, /settings, /plan-trip-ai, /admin, /public/trip. + ~30 общих компонентов/либ (все *Dialog, lib/chat.js, fx.js, useUserProfiles, i18n locale, AddressAutocomplete, MapView).

## Что осталось (приоритет)
1. Перевести весь CRUD на Supabase (диалоги Hotel/Transfer/Activity/CityVisit/Service/Doc/TripForm + удаления).
2. Починить чат (trip_messages → chat_messages).
3. Дописать+задеплоить 8 недостающих edge-функций.
4. Хронология: повесить onClick → view-диалоги.
5. Отели (реальные данные), Карта (MapView + getMapsApiKey).
6. Легаси-страницы + общие либы.
7. Фаза 4 (Stripe/Telegram webhook URLs, cron sendTripReminders, секреты).
8. Фаза 5 (миграция данных base44→Supabase, UUID, created_by→auth uid).
9. Безопасность (RLS n8n, удалить мусор) + Фаза 6 (прод-свитч).
