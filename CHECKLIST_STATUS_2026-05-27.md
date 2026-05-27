# Triplanio — детальный чеклист готовности (2026-05-27)
Легенда: ✅ работает на Supabase · 🟡 частично/с оговоркой · ❌ ещё не сделано (base44/нет)
Контекст: сделаны P0, P1, P1.7, P2 (7/8 функций), часть P3/P4. Сборка зелёная. Данные base44 НЕ мигрированы (контентные таблицы пусты).

---

## 1. Аутентификация и оболочка
- ✅ Вход через Google/Apple OAuth (Supabase Auth)
- ✅ Сессия, INITIAL_SESSION, авто-редирект
- ✅ Выход (UserMenu, экран «Доступ ограничен»)
- ✅ Лендинг на `/` для неавторизованных
- ✅ Тёмная/светлая тема (переключатель в шапке, сохранение в localStorage)
- ✅ i18n ru/en/es; смена языка сохраняется в `users.language`
- ✅ Роутинг: /trips, /new-trip, /trip/:id, /trip/:id/budget, /trip/:id/settings, /settings, /plan-trip-ai, /admin, /public/trip/:id
- ❌ Роут `/inbox` отсутствует — колокольчик уведомлений в шапке ведёт в никуда (битая ссылка)

## 2. Список трипов (/trips)
- ✅ Загрузка трипов из Supabase, карточки (обложка, даты, города)
- ✅ Кнопка «Создать» → ManualPlanner
- ✅ Открытие трипа → /trip/:id
- ✅ Лимит free-плана: показывается TripLimitDialog (getActiveTrips задеплоена)
- ❌ Действия с карточкой (копировать/удалить/поделиться/контекст-меню) — в новом списке не подключены (copyTrip-функция есть на бэке, UI нет)
- ❌ Колокольчик → /inbox (битый)

## 3. Создание трипа (ManualPlanner /new-trip)
- ✅ Пошаговое создание (города, даты) через RPC `create_trip`
- ✅ Поиск города + автокомплит адреса (placesAutocomplete на Supabase)
- ✅ Проверка лимита free-плана (свои supabase-запросы)
- 🟡 Резолв таймзоны города (placesAutocomplete) — работает только при наличии `GOOGLE_MAPS_API_KEY` в секретах

## 4. TripView — оболочка (/trip/:id)
- ✅ Загрузка трип+города (getTripDetails), затем контент
- ✅ Сайдбар: Хронология/Карта/Календарь/Бюджет/Документы/Чат + Участники/Настройки (линзы ai/hotels удалены)
- ✅ Обложка: градиент, чип городов (раскрывается), чип участников
- ✅ Кнопка «Редактировать» (toggle edit-mode), «Поделиться» (копирует ссылку), «…» (меню)
- 🟡 «Экспорт» = `window.print()` (нет PDF; exportTripPdf отложена)
- ❌ Колокольчик в шапке трипа → /inbox (битый)

## 5. Хронология (Timeline lens)
- ✅ Дни по порядку, якоря Старт/Финиш
- ✅ CityHero (фото, страна [исправлено `country`], даты, ночи)
- ✅ Предупреждение «нет отеля» + «Добавить» → HotelDialog (пишет в Supabase)
- ✅ Предупреждение «нет переезда» (логика по kind start/transit/end) + «Добавить переезд» → TransferDialog
- ✅ Карточки событий (отель/переезд/перелёт/активность), корректный маппинг полей (carrier/booking_url из схемы) [исправлено]
- ✅ **Клик по событию → просмотр + Редактировать** (Hotel/Transfer/Activity ViewDialog через SourceViewLoader) [новое]
- ✅ Edit-mode: «Добавить город» → CityVisitDialog; «Добавить активность» → ActivityDialog
- ✅ Edit-mode: «Изменить» город в CityHero → CityVisitDialog [новое]
- ❌ Edit-mode: удаление города/визита (нужен каскад по FK + подтверждение)
- ✅ Правая панель: виджет Бюджет (→ линза), «Кто едет» (→ участники)
- ❌ Правая панель: виджет «Сервисы» — кнопки добавления без обработчиков (ServiceDialog не подключён)

## 6. Отели
- ✅ Добавить/редактировать (HotelDialog) → hotel_stays
- ✅ Pro-гейт (checkSubscriptionStatus задеплоена)
- ✅ Вложения-документы (DocumentsField → Supabase Storage `documents`)
- ✅ Автокомплит адреса; определение booking-платформы по URL
- ✅ Просмотр (HotelViewDialog) + Редактировать через клик в хронологии
- 🟡 Удаление отеля (HotelTimeline на Supabase, но этот компонент в новой хронологии не смонтирован — удаление доступно только через диалог-редактирование, если там есть кнопка)
- ❌ AI-загрузка брони из файла (HotelAiUpload) — ещё base44 (InvokeLLM)

## 7. Переезды/перелёты
- ✅ Добавить/редактировать (TransferDialog) → transfers, в т.ч. доп. сегменты
- ✅ Pro-гейт; вложения; автокомплит; мультисегмент
- ✅ Просмотр + редактирование через клик в хронологии
- 🟡 Удаление (TransferStrip на Supabase, в новой хронологии не смонтирован)
- ❌ AI-загрузка из файла (TransferAiUpload) — base44
- 🟡 Поле «номер рейса» отдельно не хранится (в схеме нет flight_number; показываем carrier/booking_reference)

## 8. Активности
- ✅ Добавить/редактировать (ActivityDialog) → activities
- ✅ Вложения, автокомплит адреса
- ✅ Просмотр + редактирование через клик
- 🟡 Удаление (ActivityList на Supabase, не смонтирован в новой хронологии)

## 9. Города (визиты)
- ✅ Добавить/редактировать (CityVisitDialog) → city_visits (kind start/transit/end, даты, заметки, таймзона)
- ✅ Резолв таймзоны (placesAutocomplete)
- ❌ Удаление визита

## 10. Бюджет (Budget lens)
- ✅ Сводка, прогресс
- ✅ Добавить расход (свой диалог → budget_expenses)
- ✅ Категории (создать/редактировать) → budget_categories
- ✅ seedTripBudget (сид категорий)
- ✅ Конвертация валют (getFxRates задеплоена, fx.js на Supabase)
- ✅ Просмотр источника системного расхода (SourceViewLoader → Supabase)
- 🟡 created_by для расхода = литерал `'user'` (косметика; RLS не проверяет, но стоит проставлять email)
- ❌ Легаси-страница /trip/:id/budget (TripBudget.jsx) — ещё base44 (дубль линзы, убрать/редирект)

## 11. Документы (Docs lens)
- ✅ Загрузка файлов в Supabase Storage
- ✅ CRUD trip_documents, видимость shared/private

## 12. Участники (Members lens)
- ✅ Список участников
- ✅ Пригласить по email (inviteTripMember)
- ✅ Добавить офлайн-участника (addOfflineTripMember задеплоена) [новое]
- ✅ Сменить роль / удалить / переотправить инвайт
- ✅ Аватары/имена (resolveProfiles через useUserProfiles) [новое]

## 13. Календарь (Calendar lens)
- ✅ Просмотр месяц/неделя из событий
- ❌ Drag-перенос событий (dragEvents.js не подключён)

## 14. Чат (Chat lens) — групповой с ИИ
- ✅ Отправка/получение сообщений (chat_messages) [исправлена таблица]
- ✅ Realtime live-обновление (таблица добавлена в публикацию supabase_realtime) [новое]
- ✅ UI выпадашки @упоминаний, список участников
- ❌ Непрочитанные (chat_reads) не считаются
- ❌ ИИ-автоответ (@Triplanio → triplanioAiReply) не подключён

## 15. Карта (Map lens)
- ❌ Заглушка LensStub (getMapsApiKey задеплоена, но сама линза/MapView не реализована)

## 16. Настройки трипа (Settings lens внутри TripView)
- ✅ Редактирование названия/валюты (trips.update)
- ✅ Покинуть/удалить трип
- ❌ Тоглы фич/аддонов (calendar/budget/chat/telegram) — помечены «Скоро», не пишут в trips.details.addons
- ❌ Аддон-гейтинг линз не активен (все линзы видны всегда; в base44 calendar/budget/chat гейтятся аддоном)
- ❌ Telegram-подключение — UI-мок (TelegramConnectDialog с таймером, без реальных telegramStartLink/SetActive)

## 17. Аккаунт (/settings)
- ❌ Вся страница на base44: getUserPlan, billing portal, аватар, язык, удаление аккаунта, нотификации

## 18. ИИ-планировщик (/plan-trip-ai)
- ❌ Страница на base44; функция `planTripWithAi` НЕ задеплоена (нужна LLM-генерация — отдельная задача)

## 19. Публичный трип (/public/trip/:id)
- ✅ Read-only трип по токену (getPublicTrip задеплоена, PublicTrip на Supabase) [новое]
- ✅ Вкладка «Хронология» (ReadOnlyTimelineView)
- 🟡 Вкладка «Карта» использует MapView (getMapsApiKey) — работает только с ключом Maps
- ✅ View-диалоги отель/переезд/активность/авто (read-only)

## 20. Pro / подписки
- ✅ Диалог апгрейда (getStripePrices, createStripeCheckout) [мигрирован]
- ✅ Billing portal (createBillingPortal)
- ✅ Лимит трипов (getActiveTrips)
- 🟡 Обработка кодов ошибок Stripe (SUBSCRIPTION_ALREADY_ACTIVE и т.п.) деградирует (supabase кладёт ошибку в error.context, а не error.response.data) — показывает общее сообщение
- ❌ Stripe webhook URL не переключён на Supabase (статус подписки не обновится после оплаты) — P5

## 21. Telegram
- ✅ Edge-функции задеплоены (webhook/getIntegration/setActive/getBotInfo/getWebhookInfo/startLink/disconnect)
- 🟡 TelegramAssistantPanel мигрирован, но в новом флоу не используется (SettingsLens рисует свой мок)
- ❌ Webhook URL Telegram не переключён; напоминания (sendTripReminders) без cron — P5

## 22. Уведомления
- ✅ Колокольчик-дропдаун (NotificationsBell на Supabase), принять/отклонить инвайт
- ❌ Страница /inbox (нет роута)

## 23. Админка (/admin, /admin/notifications)
- ❌ На base44

## 24. Сервисы (eSIM / прокат авто / страховка)
- ✅ ServiceDialog/CarRentalDialog CRUD → trip_services (мигрированы)
- ❌ Не подключены в TripView (виджет «Сервисы» — кнопки без действий)

## 25. Бэкенд (Supabase Edge Functions)
- ✅ 33 функции ACTIVE (26 ранее + 7 новых: checkSubscriptionStatus, getActiveTrips, getMapsApiKey, getFxRates, telegramDisconnect, getPublicTrip, addOfflineTripMember)
- ❌ planTripWithAi — не написана/не задеплоена
- ❌ exportTripPdf, backfillTripBudget — отложены
- ✅ RLS на всех доменных таблицах; chat_messages добавлена в realtime-публикацию
- ⚠️ `n8n_chat_histories` — RLS отключён (276 строк) — дыра (P6)
- ❓ Секреты: `GOOGLE_MAPS_API_KEY` нужен для getMapsApiKey/placesAutocomplete/таймзон; без него карта/автокомплит/таймзона вернут ошибку (P5)

## 26. Данные и интеграции
- ❌ Данные из base44 не мигрированы (hotel_stays/activities/transfers/trip_members/chat = 0 строк)
- ❌ Stripe/Telegram webhook URLs не переключены; cron напоминаний не настроен (P5)
- ❌ DNS/прод-свитч triplanio.com/trips на новый билд + отключение base44 (P6)

---

## Кратко: что уже можно тестировать end-to-end на новом бэке
Вход → список трипов → создание трипа → открытие трипа → хронология (просмотр, добавление/редактирование городов, отелей, переездов, активностей, клик-просмотр) → бюджет (расходы, категории, валюты) → документы → участники (инвайты, офлайн, роли) → календарь (просмотр) → групповой чат (realtime) → публичная ссылка (read-only).

## Что НЕ работает / отсутствует
Карта; ИИ-планировщик; ИИ-ответ в чате; AI-загрузка брони из файла; страница аккаунта; админка; /inbox; виджет сервисов; удаление города; аддон-тоглы и гейтинг; Telegram-подключение (мок); drag в календаре; действия с карточкой трипа в списке; миграция данных; переключение webhooks и прод-свитч.
