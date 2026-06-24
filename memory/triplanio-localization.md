---
name: triplanio-localization
description: "Инициатива локализации Triplanio — глоссарий, объём, решение i18n vs вендор, архитектура in-app админки, файл ревью Шага 0"
metadata: 
  node_type: memory
  type: project
  originSessionId: 872e6ab0-c317-4bdc-a9d0-6f3dd407b467
---

Локализация нового приложения (репо triplanio_new, ветка main). Старт 2026-05-31.

**Текущее состояние i18n:** инфраструктура УЖЕ есть — `src/lib/i18n` (I18nContext.jsx, format.js для дат/валют/плюралов, locales/{ru,en,es}/ по 26 секций). Переводы — статические JS-модули, бандлятся на сборке (НЕ в БД). `t()` читает из объекта в памяти. Правка перевода сейчас = код + деплой.

**Объём (очищенный, только продовый UI; исключены /ui-галерея pages/redesign/Screen* кроме ScreenAccount, DesignPreview, demo-данные, имена собственные):**
- ~699 уникальных захардкоженных UI-строк (~2 440 RU-слов)
- Существующих ключей 998, из них ~566 сирот (не вызываются; часть динамическая) → ~432 живых
- Итоговый словарь ~900–1 100 ключей, ~4 000–4 500 RU-слов источника, ~12–13.5к слов на 3 локали
- БАГИ: 122 ключа вызываются в коде, но отсутствуют в ru-локали (показывают сырой id); 566 сирот.

**Зафиксированный глоссарий (2026-05-31, решения Pavel):** тон «ты»; trip→**путешествие**; event(элемент таймлайна)→**событие**; lens(раздел)→**раздел**. Внимание: trip м.р.→путешествие ср.р. ломает согласование; «поездка» (68×) и «активность» (45×) — спорные, решаются по контексту.

**Решение i18n vs вендор:** остаёмся на встроенном i18n. Вендор (Lokalise и пр.) оправдан только при не-технических переводчиках или 5+ языках (объём как раз на пороге платного Tier 2). Pavel рассматривает свою **in-app админку переводов**: гибрид «бандл-дефолт + БД-оверрайды (Supabase) + Realtime», правка без деплоя, живёт в существующей зоне /admin. Масштабируется на 8+ языков при условиях: per-language fetch, динамический import бандла, Intl.PluralRules вместо кастомного pluralCategory, список языков в данных, RTL-аудит если будет арабский/иврит. Оценка фичекита ~2–4 дня. См. [[triplanio-frontend-repo]].

**Этапы (оценка ~12–18 дней):** Шаг 0 — чистка RU-копирайта (3–5д); Шаг 1 — вынос хардкода в ключи (3–5д); Шаг 2 — перевод EN/ES ~2 440 новых слов (~2д); Шаг 3 — лендинг (частично на t(), 161 вызов + 710 хардкод-слов) + экраны авторизации (Login.jsx почти весь хардкод); фикс 122 missing + аудит 566 сирот (1–2д); QA на 3 языках (2–3д).

**Артефакт Шага 0 (v1):** `triplanio_new/I18N_STEP0_REVIEW_2026-05-31.xlsx` — устарел.

**АУДИТ v3 (2026-06-02, после +56 коммитов нового функционала):** `triplanio_new/I18N_AUDIT_2026-06-02.xlsx`. 1067 строк (285 ключей + 782 хардкода). Листы: Аудит-сводка / Инструкция / Строки / Объединение(точные дубли) / На ревью смысл-число / Битые ключи.
- 🔴 РЕГРЕССИЯ: новый функционал писали мимо i18n — хардкод вырос 654→782, ключей-сирот 566→**743**, используемых ключей меньше. Нужно правило «новый текст только через t()».
- 🔴 121 ключ вызывается из кода, но отсутствует в ru → сырой id юзеру (лист «Битые ключи»).
- 🟡 DEAD CODE: `src/pages/AiTripPlanner.jsx` — 0 ссылок (роут /plan-trip-ai переведён на ManualPlanner), удалить. redesign/Screen* кроме ScreenAccount+ScreenMap — только /ui-галерея.
- 🟡 19 строк хардкод-месяцев/дней (янв,пн…) — НЕ в ключи, локализуются через Luxon (format.js).
- Оптимизация: 24 группы точных дублей (54 строки→24 ключа); 5 групп форм числа→plural-наборы.
Pavel вычитывает «Строки», подтверждает объединения, решает 5 спорных групп → Шаг 1.

**ВЫНОС В КЛЮЧИ — ПОЭТАПНО (выбран Pavel), ru+en+es сразу. Фаза 1 готова (2026-06-02):**
- Login.jsx (auth, 6 экранов + правый промо-блок) → 75 ключей `auth.*`; рефактор меток силы пароля/политики из модульных констант внутрь компонента; «Загрузка…» переиспользует `common.loading`.
- Trips.jsx → ключи `trips.*` (+переиспользованы trips.role_*, trips.new, trips.start_with_ai, ai_plan.draft_label, common.cancel). Под-компоненты (TripCard/TripRow/NewTripDialog/CollectionEmpty) получили свой useI18n; в main Trips() конфликт имени `t` (был `.map(t=>)`) — переименовал итераторы в `tr`; scopeLabel/normalizeTrip принимают t.
- Правило перевода: в EN «AI» (не ИИ), в ES «IA», в RU «ИИ»; длинного тире нет. Каждый под-компонент — React-компонент, поэтому хук можно вставлять прямо в него.
- ⚠ ВАЖНО про детектор: построчный сканер хардкода ПРОПУСКАЕТ JSX-текст, где закрывающий тег на следующей строке (примеры в Trips: «Совместный», «N активных · N в архиве», длинное описание пустого экрана). Для финального sweep нужен multiline-aware скан (регекс `>\s*...\s*<` с DOTALL), иначе недосчёт.
- Синтаксис обеих правок проверен acorn (0 ошибок), 109 ключей Login+Trips есть во всех 3 языках.

**Хотфикс (2026-06-02):** баг моей замены тире — регекс `\s—\s` (где `\s`=перенос строки) на строках, кончавшихся на «—», СЪЕДАЛ перенос и приклеивал след. строку к комментарию. Сломал 2 ключа (`telegram.unlink_title`, `telegram.account_section_title` в ru/en/es) — утонули в комментарии. Восстановлено. Всего таких склеек было 21, но функц. сломаны только эти 2 (остальные 19 — комментарий+комментарий, косметика). Также добавлен `sub.period_once` (был сырой id в Pro.jsx). ВАЖНО: LandingPage.jsx имеет СВОЙ локальный useT() — его ключи (hero/footer/faq…) к глобальной локали не относятся, в скане битых ключей это ложные срабатывания. Реальных битых ключей: 0.

**Фаза 2 готова (2026-06-02):** Pro.jsx + платёжные диалоги (TripLimitDialog, PaymentSuccess/FailDialog, ProLockedDialog, TripProInfoDialog, StripeReturnModals) → 44 ключа `sub.*` + `common.got_it`; переиспользованы common.back/close/copied, trip.copy_link, trips.go_pro, sub.processing/plan_*/period_*. EN=«AI», ES=«IA». Синтаксис ок, 73 ключа есть во всех языках.

**Фаза 3 — TripView ГОТОВ (2026-06-03):** ~95 строк, 16 под-компонентов, +53 ключа trip.*. Все под-компоненты получили useI18n; helpers buildEventStream/formatDuration принимают t (итератор t→tr). Синтаксис ok, 0 хардкода, нет t() без хука. ⚠ УРОК: `replace_all` подписей сайдбара задел скелет LoadingScreen (те же тексты) — а там не было хука → краш «t is not defined» при открытии трипа. Исправлено добавлением хука. Правило: после массовых replace_all в большом файле проверять «t() без хука» по всем компонентам (скрипт-детектор с учётом export function).

**Фаза 4 — MembersLens ГОТОВ (2026-06-03):** ~52 строки, +35 ключей member.*; RoleBadge/StatusDot/InviteDialog/ChangeRoleDialog/MembersLens → useI18n; ROLES-массив → labelKey. Переиспользованы роли, common.*, members.*, trip.*, share.copy. Синтаксис ok, хардкода 0 (кроме defensive-фолбэка 'Ошибка' в модульном edgeErrorMessage — недостижим). **Фаза 5 (2026-06-03):** DocsLens ГОТОВ (+25 doc.* ключей, 6 компонентов) и Inbox ГОТОВ (+14 notif.* ключей; dateGroup отрефакторен на стабильные ключи today/yesterday/week/earlier + GROUP_LABEL_KEY→t). Добавлены 12 chat.* ключей для ChatLens — НО ChatLens.jsx ещё НЕ переведён (ключи пока orphan, дописать). CalendarLens НЕ сделан (месяцы/дни недели → брать из Luxon Info, не плодить 19 ключей). Синтаксис ok, хардкода 0 в готовых.

ChatLens ГОТОВ (chat.* ключи wired + chat.send). CalendarLens ГОТОВ — месяцы/дни недели через Luxon Info.months/weekdays (localeTag(lang)), 0 ключей на названия; +5 calendar.* ключей (to_trip_start/legend_city/legend_transport/week_word/week_no_data); useMemo-deps включают MONTH_NAMES/WD_NAMES для ре-локализации при смене языка.

**BudgetLens ГОТОВ (2026-06-03):** ~59 строк, +35 budget.* ключей, 6 компонентов (AddExpenseDialog/FxRatesDialog/AddCategoryDialog/ExpenseRow/BudgetLens/CityGrouping). Плюрал трат через budget.expenses_count_one/few/many. Синтаксис ok, хардкода 0.

ГОТОВО ВСЕГО: Login, Trips, Pro+платежи, TripView, MembersLens, DocsLens, Inbox, ChatLens, CalendarLens, BudgetLens.
**SettingsLens — ОСНОВНАЯ ЧАСТЬ ГОТОВА (2026-06-03):** +39 settings.* ключей; FEATURES→labelKey/descKey; FeatureRow/ApproverRow/main на useI18n; обработчики save/leave/delete + alert/confirm локализованы; feat.label→t(feat.labelKey) в toggleFeature. Синтаксис ok. ОСТАЛОСЬ в файле 31 строка — ТОЛЬКО в Telegram-компонентах (TelegramConnectDialog + TelegramSection), отложено (много reuse из telegram.*). Файл компилируется.

**SettingsLens ПОЛНОСТЬЮ ГОТОВ (2026-06-03):** Telegram-часть закрыта (+20 settings.tg_* ключей). ВАЖНО: секция telegram.* в локали — вы-форма (легаси); чтобы держать ты-тон, переиспользовал только нейтральные (connect_title/link_label/open_bot/connect_another/not_connected_title/unknown_user), а ты-специфичные завёл как settings.tg_*. Синтаксис ok, хардкода 0.

**EventModal + EventAiBlock ГОТОВЫ (2026-06-03):** создана НОВАЯ секция `event` (event.js в ru/en/es + импорт/спред в index.js всех 3 языков!) — ~46 ключей event.*. EventModal: eventTheme label→labelKey, paymentLabel(t,...), 5 компонентов на useI18n. EventAiBlock: pluralFields(t,n), Title-компонент на хук, все состояния (locked/available/idle/uploaded/parsing/parsed). Синтаксис ok, хардкода 0.

ГОТОВО (13 файлов): Login, Trips, Pro+платежи, TripView, MembersLens, DocsLens, Inbox, ChatLens, CalendarLens, BudgetLens, SettingsLens, EventModal, EventAiBlock.

**КРИТИЧЕСКАЯ АРХИТЕКТУРНАЯ НАХОДКА (2026-06-03):** проверил роутинг (App.jsx) и TripView. Из `pages/redesign/Screen*` ЖИВЫЕ только ДВА: **ScreenMap** (рендерится живым TripView) и **ScreenAccount** (роут /settings). ВСЕ остальные redesign/Screen* (ScreenTimeline, ScreenManualPlanner, ScreenAiPlanner, ScreenForms, ScreenBudget, ScreenChat, ScreenSettings, ScreenMembers, ScreenCalendar, ScreenDocs, ScreenInbox, ScreenPro, ScreenHotels, ScreenCollection, ScreenPublic, ScreenSystem, ScreenAI, ~700+ кир.строк суммарно) ссылаются ТОЛЬКО из DesignPreview (роут /ui = галерея мокапов), НЕ видны юзеру. Локализация мокапов = низкий приоритет/возможно зря. Живые роуты: /trips=Trips, /new-trip+/plan-trip-ai=ManualPlanner, /trip/:id=TripView, /trip/:id/edit=TripStructureEdit, /settings=ScreenAccount, /inbox=Inbox, /pro=Pro, /login=Login, /public/trip/:id=PublicTrip, /=Landing(оставляем).

**СЕССИЯ 2026-06-03 (продолжение) — +5 живых файлов готовы:**
- **ScreenMap.jsx** ГОТОВ: +18 view.map_* ключей, transfer.bike новый; KIND_META→labelKey; RouteStepper/ActiveCityCard/TransferRow/HotelRow/Legend на useI18n; плюралы городов/ночей переиспользуют trip.cities_count_*/view.nights_*/ai_plan.unit_nights_short. Итератор transfers.some(t→x).
- **EventEditDialog.jsx** ГОТОВ (2179 строк, центр. модалка событий): секция `event` расширена 50→**150 ключей**. TYPE_META/TRANSPORT_KINDS→labelKey; 8 под-компонентов (CityPicker/HotelFields/TransferFields/LayoverToggle/SegTransportGrid/SegmentsEditor/ActivityFields/ServiceFields) на useI18nFormat; saveLayoverChain получил t-параметр. Переиспользованы common.cancel/save/delete/open. ИСПРАВЛЕН грамм-баг 'без…календарной разделы'→'календарного раздела' (был в ScreenAccount free_desc, не тут).
- **ManualPlanner.jsx** ГОТОВ (/new-trip+/plan-trip-ai): новая секция `planner` (**83 ключа** в ru/en/es + import/спред в index 3 языков). STEPS→labelKey; shortDateLabel переписан на Intl.DateTimeFormat(locale) (убраны RU _MONTHS_SHORT); computeAutoTitle получил t; 7 под-компонентов на useT; CityRow получил lang. ⚠ НЕ переиспользовал ai_plan.save_trip ('Сохранить Поездку') — глоссарий-долг (см. ниже).
- **ScreenAccount.jsx** ГОТОВ (/settings, Pro/биллинг!): новая секция `account` (**75 ключей**, ты-тон). SubscriptionCard+main на useI18nFormat. ConnectedAccountsSection уже был локализован. Native-имена языков ('Русский'/'English'/'Español') оставлены как есть (правильно для пикера). Переиспользованы settings.saved/theme*/language/danger_zone/delete_account, auth.logout/saving, notif.to_collection, common.*.
- **TripStructureEdit.jsx** ГОТОВ (/trip/:id/edit): новая секция `tse` (**67 ключей**). +import useT/useI18n (файл не имел i18n). fmtD/fmtDW→Luxon setLocale(lang).toFormat (убраны RU MONTHS/WD); dayWord(n,t); TKIND/POINT_TYPES/PLATE_META→labelKey/subKey; 13 компонентов на хук (GridTransfer: его проп `t`=transfer → i18n-фн назвал `tx`). Переиспользованы transfer.train/bus/ferry, event.tk_car/city/type_*, ai_plan.start/end, planner.trip_start/night_short, trip.cities_count_*.

**НОВЫЕ СЕКЦИИ локали (зарегистрированы в index.js 3 языков):** event(150), planner(83), account(75), tse(67). Все проходят acorn-parse, ключи матчатся 1:1 ru/en/es.

**ГЛОССАРИЙ-ДОЛГ — ИСПРАВЛЕНО (2026-06-03):**
1. ✅ `ai_plan.js` (ru): 14 правок глоссария (Поездк→путешеств, «вы»→«ты», Title Case→sentence: 'ИИ Планировщик Поездок'→'ИИ-планировщик путешествий', 'Сохранить Поездку'→'Сохранить путешествие', 'Города и Даты'→'Города и даты', 'Поездка от ИИ'→'Путешествие от ИИ', 'Черновик готово'→'готов' и т.д.). + Добавлены 3 ОТСУТСТВОВАВШИХ ключа (показывали сырой id): ai_plan.start_badge/end_badge/map_loading (ru/en/es). Дубли ai_plan.* УДАЛЕНЫ из common.js (22 ключа ×3 языка) — ai_plan.js был супермножеством, спред позже всё равно перекрывал; теперь единый источник. 0 missing после чистки.
2. ✅ `settings.js` (ru): 6 правок «вы»→«ты»/Title (delete_account_confirm 'ваш'→'твой', plan_pro 'Pro Подписка'→'Pro-подписка', plan_pro_feature_members 'ваших'→'твоих', plan_portal_iframe_error 'откройте'→'открой', delete_account_support_msg 'обратитесь'→'обратись', delete_account_blocked_msg 'У вас…отмените…попробуйте'→'У тебя…отмени…попробуй').
3. Грамм-баги исправлены по ходу: 'двигает весь путешествие'→'всё путешествие' (TSE), 'календарной разделы'→'календарного раздела' (account free_desc); «вы»→«ты» в toast'ах TSE/Planner.

**СЕРВЕРНАЯ ЛОКАЛИЗАЦИЯ (проверено по коду edge-функций, мой ранний вывод «RUSSIAN ONLY» был НЕВЕРЕН):**
- `telegramWebhook/index.ts` — бот welcome/link/invalid/used/expired ЛОКАЛИЗОВАНЫ ru/en/es (T-таблица, язык из users.language или TG language_code). ✅
- `_shared/emailTemplate.ts` — письма invite/resend ЛОКАЛИЗОВАНЫ ru/en/es (I18N, fallback en). ✅
- `getPendingReminders/index.ts` — возвращает структурированные данные + `user_locale` в n8n; ТЕКСТ напоминаний формируется в **n8n** (не в репо). en/es зависят от шаблонов в n8n-воркфлоу. Репо локаль уже прокидывает.
- `notifications-catalog.js` — это dev-документация (/admin/notifications). Исправлены устаревшие комменты «RUSSIAN ONLY» → отражают telegramWebhook(локализ.)/n8n(user_locale). hardcodedText в каталоге всё ещё показывает старый RU-baseline — это документация, не рантайм.

**ES-долг (НЕ трогал, отдельная задача):** испанские локали повсеместно в Title Case ('Planificador de Viajes con IA','Guardar Viaje','Empezar de Nuevo' и т.п.) — испанский требует sentence case. Вынесено в отдельную память [[triplanio-es-titlecase-debt]].

**TASK 18 (финал) — 2026-06-03:**
- **Dead code:** `src/pages/AiTripPlanner.jsx` (10-строчный депрекейтед-шим, 0 ссылок, не в роутере) — НЕ удалён из песочницы (Operation not permitted). Pavel: `git rm src/pages/AiTripPlanner.jsx`.
- **Полный multiline-sweep по ВСЕМ живым src** (исключая locales, Landing, /ui-мокапы redesign/Screen* кроме Map/Account, dead AiTripPlanner). Нашёл и ПОЧИНИЛ 7 файлов, не входивших в ранние батчи:
  - HeaderActions.jsx (+useT; nav.toggle_theme/account) — шапка на каждой странице!
  - SourceViewLoader.jsx (+useT; reuse event.delete_failed)
  - DocumentsList.jsx (+useT; default title='' → event.documents; event.file_word)
  - FlowMap.jsx (+useT; плюралы городов/ночей через trip.cities_count_*/view.nights_*)
  - PanelAi.jsx (уже t; +ai_plan.to_skeleton, ai_plan.unit_nights_short, planner.night_short)
  - booking-platforms.js: 'other' платформа получила labelKey: 'event.view_booking' (label оставлен фолбэком); 4 консьюмера (EventEditDialog ×3, EventModal ×1) → `platformInfo.labelKey ? t(labelKey) : label`.
  - Новые ключи: nav.toggle_theme, nav.account, ai_plan.to_skeleton (×3 языка).
- **Намеренно НЕ трогал (sweep-исключения):** design/index.jsx (96 — демо-данные дизайн-системы, /ui), dock.jsx (22 — мокап, НИКЕМ не импортируется = dead), currencies.js ('лв'/'дин' = символы валют, не UI), translations.js/'Русский' (native-имя, корректно), notifications-catalog.js (dev-док), validation.js (отложено Pavel), AppErrorBoundary.jsx (3 строки — это КЛАСС-компонент без хуков, экран краша; локализация рискованна, оставлено RU как fallback — отдельная задача через Context.Consumer), MembersLens edgeErrorMessage fallback 'Ошибка' (модульный default-параметр, недостижим).
- **АУДИТ СИРОТ:** 646 orphan-ключей из 1809 (static-ref 1151 + динамич. префиксы chat.people_/trips.role_/view.nights_/trip.cities_count_/trip.nights_/transfer.with_layover_/public.subtitle_days_/telegram.tg_trips_/faq.a). Большинство — наследие удалённых легаси-диалогов (ai.* старый аплоадер→event.ai_*, *.dialog_*, старые hotel/activity-диалоги). РЕШЕНИЕ (моя рекомендация как аналитика): НЕ удалять массово — выгода ~копейки в бандле, риск реальный (эвристика не видит полностью динамические t(var) → сырой id в проде). Правильный путь — build-time линтер неиспользуемых ключей, не разовая чистка. Скрипт аудита: outputs/sweep_fix.py + инлайн-аудит.

**ИТОГ ЛОКАЛИЗАЦИИ:** весь живой UI переведён ru/en/es (кроме отложенных Pavel validation.js + PublicTrip.jsx и класс-компонента AppErrorBoundary). Серверная локализация (бот/письма) на месте.

**ОТКРЫТЫЕ TODO (записаны по просьбе Pavel 2026-06-03):**
- ⬜ **AppErrorBoundary.jsx** — локализовать экран краша. Это КЛАСС-компонент, хук useT() не работает → нужен `Context.Consumer` (обернуть в I18nContext.Consumer и достать t). Низкий приоритет (виден только при краше). 3 строки: 'Что-то пошло не так'/'На главную'/'Неизвестная ошибка'.
- ⬜ **Плейсхолдеры дат «ддммгггг»** — это НАТИВНЫЙ `<input type="datetime-local">` (DateTimeInput.jsx), формат рисует браузер по локали ОС, placeholder игнорируется. Полный контроль = замена на кастомный date-picker (отдельная задача). Best-effort: атрибут `lang` на инпуте (поддержка частичная). НЕ простой перевод строки.
- ⬜ ES sentence-case полировка [[triplanio-es-titlecase-debt]]; orphan-линтер вместо ручной чистки 646 ключей; n8n-шаблоны напоминаний en/es.

**ПРАВКИ ПО ТЕСТУ Pavel (2026-06-03) — items 1-4:** даты таймлайна (fmtDate/weekday в design/index.jsx → Intl с loc-параметром, ru-дефолт байт-в-байт сохранён чтобы НЕ трогать Public; lang прокинут в CityHero+TimelineLens), «Ссылка» (PartnerPill fallback → common.link), сервисы («Добавить {name}» в ServiceRowEmpty → trip.svc_add), города-пикер (searchCities 'ru'→lang в EventEditDialog+ManualPlanner; гео-данные coords/tz/code/id language-independent, сохраняются ок). Планнер: «Далее:» в FlowProgress захардкожен (скан пропустил из-за `{` в JSX-тексте) → ключ planner.next_label='Далее', тем же ключом заменена кнопка «К скелету» в PanelAi (ai_plan.to_skeleton удалён как orphan).

**TASK 17 ГОТОВ (2026-06-03) — живые lib/components:**
- **ChatWidget.jsx**: +useI18n; +7 chat.* (open_aria/open_full_aria/write_first/widget_composer_ph/people_one/few/many); reuse chat.group_title/typing/mention_all_hint/send, common.close.
- **DocumentsField.jsx**: +useT; default label='' → рендер `{label || t('event.documents')}`; +6 doc.* (file_too_big_title/max_size/remove_doc_aria/upload_files/add_more_files(уже был)/remaining); reuse event.ai_upload_error/file_word, common.loading.
- **TripAccessDenied.jsx + PageNotFound.jsx**: новая секция `sys` (**7 ключей**, зарег. в index 3 языков). SystemStub берёт текст пропсами (хук не нужен). Грамм-фикс 'путешествие был удалёно'→'было удалено'.
- **CurrencyCombobox.jsx + CurrencySelect.jsx**: +useT; +3 common.* (choose/not_found/currency_search_ph); reuse budget.field_currency.
- **NotificationsBell.jsx** (уже имел t): +3 notif.* (all_read/all_read_desc/open_full_inbox). NotifRow получает t пропсом.
- **chat.js**: pluralPeople(n) → **pluralPeople(n,t,lang)** локале-зависимый через pluralCategory (RU few/many, EN/ES one/many); импорт pluralCategory из format.js. Оба вызова (ChatWidget + ChatLens) обновлены; ChatLens получил lang в useI18n. ⚠ это чинило скрытую RU-утечку в «готовом» ChatLens.
Новые/расширенные секции: sys(7 new). chat +7, doc +6(−1 дубль), common +3, notif +3. Все 14 файлов: acorn ok, multiline-sweep чисто (кроме native 'Русский' в пикере — корректно).
- **notifications-catalog.js — НЕ трогал намеренно**: это dev-каталог-документация (рендерится /admin/notifications); hardcodedText/subject_* документируют то, что шлют edge-функции/n8n (Telegram = RUSSIAN ONLY = долг edge-функций, НЕ фронта). Вайрить в t() неверно.

ДАЛЕЕ (отложено Pavel): validation.js (рефакторят отдельно), PublicTrip.jsx (пока пропустить). ФИНАЛ (task18): dead-code AiTripPlanner.jsx (0 ссылок), аудит ~743 orphan-ключей, общий multiline-sweep. /ui-мокапы — РЕШЕНО ПРОПУСТИТЬ (Pavel). Скрипты сессии: outputs/{eed,planner,account,tse,misc}_{addkeys,wire}.py.

**Фаза 3 архив (в процессе было):** добавлено 50 ключей `trip.*`. Готово: хелперы `buildEventStream`/`formatDuration` (прокинут `t`, переименован итератор `t`→`tr` чтобы не конфликтовал с i18n-`t`; вызов и useMemo-deps обновлены), ErrorScreen, TripHeader, TripSidebar (массивы LENS_ITEMS/MGMT_ITEMS теперь labelKey + t(item.labelKey), Free-блок, Поделиться). Синтаксис ок. ОСТАЛОСЬ (~42 строк-литерала + JSX): CityHero, TimelineLens, ShareDialog, MoreMenuDialog, TripCoverStrip, ContextSide (бюджет/участники/сервисы), ServicesWidget, ServiceRowEmpty, главный render. Ключи под них уже в trip.js (часть пока unused). Детектор хардкода должен быть multiline-aware (JSX-текст с тегом на след. строке).

**ПРИМЕНЕНО К КОДУ (2026-06-02):** прогон RU-правок прямо в исходники (152 файла, синтаксис проверен acorn — 0 ошибок). Сделано: глоссарий трип→путешествие (склонение+род, сплошняком по всем shipped+locale, т.к. кир.«трип» в коде только в тексте — латинские tripId не трогаются), линз→раздел, AI→ИИ (только в RU-тексте, не в идентификаторах/ключах). **Длинное тире «—»/«–» убрано ВЕЗДЕ → обычный дефис «-» (требование Pavel: не использовать длинное тире в текстах).** Контекстные (поездка→путешествие?, активность→событие?) и ты←вы НЕ прогонялись сплошняком — правим на ходу. Ключи пока НЕ выносили (Шаг 1 позже). Скрипты: outputs/i18n_audit.py, apply_ru.py, build_xlsx.py. Закоммитить в main И dev (оба деплоятся).
