---
name: triplanio-standalone-screens-unification
description: "Triplanio — унификация standalone-экранов (ширина, +шит, шапка, список) 2026-06-20"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6808737c-ea84-4f91-b0ff-aa03b1a36c7b
---

★РЕАЛИЗОВАНО 2026-06-20 (lint+build+53 теста зелёные, ждёт push dev+main + живой смоук). 5 правок по Главная/Статистика/Профиль/Нотификации:

1. **Глобальный create-flow**: новый `src/components/create/CreateTripProvider.jsx` (context `useCreateTrip` → `openChoice`/`startCreate`, экспортит `ChoiceCard`), смонтирован в `App.jsx` внутри `MobileNavProvider`. FAB боттом-нава (app-вариант) теперь `openChoice()` на месте вместо `nav('/trips?new=1')`. `Trips.jsx` переиспользует провайдер — удалены инлайновые `NewTripDialog`/`ChoiceCard`/`checkLimit`/`handleProceed`/`?new=1`-эффект. **Pro-лимит теперь единый серверный источник**: `TripLimitDialog` без props сам фетчит `getActiveTrips` (гасит долг «4 места дублируют лимит»); ценой краткого спиннера на /trips. Баннер «1/1» на Trips остался на локальном `ownedActiveTrips` (только дисплей).
2. **Заголовок Статистики в шапке**: `Statistics` теперь шлёт `title={t('stats.page_title')}` в `AppHeader` (как профиль/нотиф); видимый `<h1>` в `.head` оставлен по решению Павла.
3. **Ширина контента = как у трипа (overview)**: контент трипа (`.trip-screen-body`/`.trip-content`) БЕЗ max-width (full-width минус сайдбар 220px). Первая попытка (кэп 1120 «как профиль») была ОТВЕРГНУТА Павлом — это уже overview. Итог: Trips/Statistics/Inbox main сделаны **full-width** (`width:100%`, padding `32px 28px`, без maxWidth/центрирования) — как `.trip-screen-body`. Профиль (`.acct-shell` 2-панельные настройки) оставлен на 1120 (эталон, формы не растягиваем). Токен `--content-max` удалён.
4. **Плейсхолдер в списке**: `.tr--add`+`.tr__addic` (модификатор `.tr`, язык `.tc-add`) — строка добавления в режиме список (только active).
5. **Адаптивный тулбар**: `.trips-toolbar` (+`__search`/`__spacer`, классы `.seg--filter`/`.seg--view`); на ≤640px поиск на отдельной строке во всю ширину; кнопка «Новое путешествие» обёрнута в `.trips-newbtn` и скрыта на мобайле (FAB дублирует).

Мёртвый код: `Layout.jsx` (старый боттом-нав) в роутах не используется — кандидат на удаление. Открыто: обновить Notion (Pro-лимит/архитектура create-flow). См. [[triplanio-trip-limit-sources]], [[triplanio-pro-model]], [[triplanio-bottomnav-header-unification]].
