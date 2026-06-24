---
name: triplanio-copy-audit-2026-06-06
description: "Сплошной аудит текстовок Triplanio (1921×3 ключа): применено 192 механ. правки, 12 спорных решений ждут Pavel, баги текст↔функция"
metadata: 
  node_type: memory
  type: project
  originSessionId: 935d682a-ea6e-4a34-9ac1-f820f7f3a38d
---

Сплошной copy-аудит всех текстовок (2026-06-06, ветка dev). Развитие P0 voice-пасса ([[triplanio-design-ux-audit]], [[triplanio-localization]]).

**Объём:** 33 неймспейса × 3 языка (en/es/ru) = 1921 ключ/язык, файлы `src/lib/i18n/locales/`.

**Применено (192 правки, build зелёный, паритет ключей идеальный):** убраны tech-термины (метаданные→детали, режим структуры→редактирования, парсинг→распознавание, апгрейд→переход на Pro, инбокс→Входящие, чекаут→оплата, драфт→черновик, фичи→функции, варнинг→предупреждение, таймзона→часовой пояс, занять блокировку→войти в режим редактирования); остатки «вы»→«ты»; битая грамматика; символы/стрелки/`$` из текста; EN+ES Title Case→sentence case.

**ЖДЁТ РЕШЕНИЯ Pavel (12 спорных, НЕ применены)** — в `COPY_AUDIT_2026-06-06.md` §4: (1) слово для «аддон»; (2) шаги планнера Скелет/Финальный драфт; (3) имя Free-тарифа; (4) Upgrade trip EN/ES; (5) approver EN/ES; (6) viewer Зритель↔Участник; (7) Оффлайн-участник; (8) имя Inbox; (9) транзит/пересадка; (10) account.identity→Профиль (подтвердить); (11) тон маркетинга sub/trips/account; (12) generate_draft CTA.

**Баги текст↔функция (§5 аудита):** sub.badge_discount «−33%» захардкожен в Pro.jsx (не из Stripe — money!); sub.plan_pro_feature_past «Edit past trips» — проверить реальность Pro-гейта; validation.TRIP_PAST_READONLY не эмитится; admin.notifications.when переиспользован в клиентских EventPanels/EventViewBody (нужен event.when_label); chat.ai_can_3 возможно обещает нереализованное; мёртвые ai_plan.* в ru/trip.js.

**Хардкод вне i18n (план выноса, §6, НЕ применено):** LandingPage.jsx (целый инлайн-i18n объект + «voucher parsing» в FAQ); design/index.jsx ~682 RU fallback-литералы (мёртвые); MembersLens E-mail; NotificationsBell ✓.

**ФАЗА 2 (решения Pavel, применено, build зелёный, паритет 1921×3, diff 78 файлов 609/609):** аддон→Расширения/Add-ons/Extensiones; шаг Скелет→Маршрут, Финальный драфт→Проверка; раздел редактора→Планирование/Planning/Planificación; Pro-кнопки унифицированы→Улучшить до Pro/Upgrade to Pro/Mejorar a Pro (trips.go_pro=навигация, оставлен); viewer RU→Наблюдатель; Inbox RU Входящие/ES Bandeja de entrada; account.identity→Профиль. Free и «Оффлайн» оставлены по реш. Pavel. Обобщён «вылет»: tse.departure_word→«Отправление». Убраны завершающие точки у 560 одно-предложенческих строк (проза/?/!/…/сокращения сохранены).

**Транзит→пересадка ПРИМЕНЕНО** (коллизии не было: «транзит» был только у 1-дневной точки-проезда; тип с ночёвкой = «Город»/«Остановка с ночёвками»). Убрал слово: transit_word→«проездом»/«passing through»/«de paso», tse.transit→«пересадка»/«layover»/«escala», pt_waypoint_sub→«На 1 день, без ночёвки». Тип-точка = «Пересадка»/«Layover»/«Escala».

**ФАЗА 3 (применено, build зелёный, 34 неймспейса/2110 ключей):** планнер обобщён — home_title→«Откуда стартуешь?»/«Where do you set off?»/ES уже «¿Desde dónde sales?», departure_date→«Дата отправления», return-descs убрали fly/volar; CTA generate_draft RU→«Собрать маршрут». ВЫНОС ХАРДКОДА: триаж показал — приложение уже почти всё на i18n, кириллица в jsx = в основном комментарии/regex. Реально вынесено: (1) AppErrorBoundary→самодостаточная 3-яз карта CRASH_COPY (не центр. i18n намеренно — крэш-экран); (2) LandingPage имел свой инлайн TRANSLATIONS(en/es/ru ~189 ключей)+свой useT/LangCtx → перенесён в locales/{en,es,ru}/landing.js (префикс landing.), на центр. useT/useI18n; ПОБОЧНО исправлен баг рассинхрона языка (лендинг хранил triplanio.lang, приложение travel-planner-lang → теперь общий). Оставлено: символы валют лв/дин, родные имена языков, мёртвые label-фоллбэки (уже с labelKey), бот-шаблоны notifications-catalog (вне охвата).

**НАЙДЕН Pro-баг (не правил, money/gating):** прошлые поездки — структуру Pro редактировать МОЖЕТ (TripView canEditMode=…||tripIsPro), но TripFormDialog (название/описание) блокирует прошлые для ВСЕХ вкл. Pro (не получает tripIsPro). Фикс: прокинуть tripIsPro→isPastVisit=…&&!tripIsPro.

**ОТКРЫТО (ждёт Pavel):** тон маркетинга (sub/trips/account); sub.badge_discount хардкод в Pro.jsx (Pavel делает Stripe отдельно); Pro-гейт TripFormDialog (выше).

**Доки:** репо — `COPY_STYLE_GUIDE_2026-06-06.md` (спека) + `COPY_AUDIT_2026-06-06.md` (отчёт, §8 = фаза 2). Notion — страница «Копирайт и локализация интерфейса (i18n)» под корнем Triplanio. Связано: [[triplanio-es-titlecase-debt]], [[triplanio-i18n-no-hardcode]].
