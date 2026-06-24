---
name: triplanio-overview-screen
description: "Новый главный экран трипа Overview (Обзор) — состав, архитектура, что переехало"
metadata: 
  node_type: memory
  type: project
  originSessionId: a07f61b1-109c-47a0-917c-286d7ce5dc61
---

Overview = новый ГЛАВНЫЙ экран трипа (lens `overview`), первый в меню, дефолтная линза вместо `timeline`. Живёт в шелле TripView (хедер+hero+сайдбар), отдельного роута нет.

**Состав (2 колонки, схлоп в 1 на ≤880px):** слева `RouteMapCard` (реальный MapView/Mapbox, mapControls=false, кнопка «Открыть»→lens map) + `TripStatRow` (5 карточек: Города/Страны/Переезды/Путь(км)/Длительность дн·ноч); справа `BudgetSummaryCard` + `MembersSummaryCard`.

**Новые файлы:** `pages/OverviewLens.jsx`; `components/trips/{RouteMapCard,TripStatRow,BudgetSummaryCard,MembersSummaryCard}.jsx`; `lib/trip-stats.js` (uniqueCountryCount, tripDateSpan, tripDuration, routeDistanceKm=haversine по координатам визитов, tripStats); `lib/budget/category-colors.js`. i18n: `lib/i18n/locales/*/overview.js` + ключ `trip_menu.overview`.

**Переезд виджетов:** Бюджет и «Кто едет» ВЫРЕЗАНЫ из `ContextSide` (правый рейл таймлайна) — теперь живут только в этих переиспользуемых картах (Overview). На таймлайне в рейле остался ТОЛЬКО виджет Сервисы. `BudgetSummaryCard`/`MembersSummaryCard` сами владеют fx-контекстом/ordered-members (логика перенесена из ContextSide). Из TripView выпилены ставшие неиспользуемыми импорты (useFxRates/toMain/fmtMoney/useUserProfiles/displayName/Avatar).

**Цвета категорий → Lumo-токены:** единый источник `lib/budget/category-colors.js` = `--cat-1..8` (token+hex). `BudgetLens` CAT_COLORS перенацелен на новый палитр (старый slate/blue выпилен). `categoryStyles.js` был мёртв (0 импортеров) → выпотрошен в tombstone (хост не дал удалить файл — удалить в обычном чекауте). Существующие категории рендерятся со своим сохранённым hex (без разрушит. миграции БД), новый выбор берёт Lumo-палитру. Связано: [[triplanio-lumo-gap]] (там это значилось как остаток), [[triplanio-style-token-audit]].

**Побочный фикс:** в app.css `--primary-soft`/`--primary-soft-2` РАНЬШЕ не были определены, хотя на них ссылались (.metastrip .ch--p, .upload:hover, новые виджеты) → тихо ломались. Добавлены в light+dark :root. ВАЖНО: `--primary` в index.css = HSL-тройка, как ЦВЕТ ломается → для primary-цвета использовать `--brand` (=hsl(var(--primary))). Старые `.metastrip/.upload` ещё используют `color: var(--primary)` — пре-существующий баг, не трогал.

**Верификация:** vite build зелёный, eslint чистый по изменённым, гард check-design-tokens PASSED, математика стат проверена. ⚠️ браузер-ревью (десктоп+мобайл) НЕ делал — computer use выключен. Деплой: фронт авто через Vercel по пушу (dev+main), Supabase не затронут. Связано: [[triplanio-deploy-topology]], [[triplanio-frontend-repo]].
