---
name: triplanio-map-markers-ring
description: "Карта переведена на Ring-маркеры на токенах + токенизированные линии + selected-состояние (реализовано, ждёт пуш/смоук)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 547ee15a-8a9e-48a7-a50d-741f7743792c
---

★РЕАЛИЗОВАНО 2026-06-17 (ветка dev, lint+46 тестов+vite build зелёные; ждёт пуш dev+main и живой смоук-тест). Редизайн всех маркеров и линий на ВСЕХ картах (Overview/Map-линза/Edit/публичный трип/планнер) в стиль **Ring** Lumo.

**Маркеры** (`src/lib/map/markers.js` + CSS `.tmk*` в конце `src/design/app.css`): теперь DOM-классы вместо inline-hex. Маркер — узел под `<html data-theme>`, поэтому токены каскадируют → день/ночь без перерисовки. Ring = светлая заливка `--surface` + кольцо/глиф цветом `--tmk` (по умолчанию `--brand`, finish=`--warm`). Роли: transit=число, start/finish=флаг (одинаковый path, цвет различает), waypoint=меньше (`.tmk--wp`). 2/3 визита=пилюля `.tmk--wide`/`.tmk--w3`. Состояние **selected** (`.is-sel`): залитое кольцо+белый глиф, scale, halo+pulse (выкл при reduced-motion). Трансформы — на внутреннем `.tmk__core`, НЕ на корне (его двигает Mapbox).

**Линии** (`src/lib/map/routeLines.js`, `mapTokens.js` НОВЫЙ, `mapStyle.js`, `mapbox.js`): цвет из CSS-токена `--map-route` (concrete hex, добавлен в app.css light `#2173C8`/dark `#6FB2FF`) через `routeColor()` — paint не берёт var(). Репейнт при смене темы: `repaintRouteLines(map)` вызывается в scheme-эффекте `useMapSurface.js` (`setPaintProperty line-color`, без перестройки геометрии). Дуга/транспорт=brand. mapStyle оставил только ширины/опасити; **выпилены** `ROUTE_COLOR/DASHED_COLOR/MARKER_*` (grep по репо чист).

**Provyazka selected**: `MapView` принял проп `selectedVisitId` (метит маркер `.is-sel`, добавлен в deps draw-эффекта). Источник: `ScreenMap` → `route[activeIdx].id` (активный шаг степпера линзы); `TripStructureEdit` → `selectedNodeId` из `leftPanel` (city / hotel.city_visit_id / activity.city_visit_id / create-pick visit; transfer-панель не метит один город). PublicTrip/RouteMapCard — без выбора.

**Выбранный маршрут (segment)** [доб. 2026-06-17, ФИКС]: `routeLines.js` → `drawRouteHighlight(map,leg)`/`clearRouteHighlight` рисует над базой casing(`--map-route-ring`)+main; transport=solid, без=dashed; геометрия=тот же rule (flight arc/OSRM-кэш/прямая). ВАЖНО: `MapView` проп — `selectedLegKey` (строка `fromId__toId`), а НЕ объект-геометрия. MapView сам резолвит from/to из `ordered` и kind из `transferKindByPair` (memo по live `transfers`, включающим `previewTransfer`), эффект зависит от `transferKindByPair` → при добавл./смене транспорта подсветка ПЕРЕРИСОВЫВАется в одну дугу синхронно с базой. (Баг старой версии: проп был геометрия-объект с kind из панели-создания=всегда undefined → highlight не обновлялся, оставались 2 дуги — selected старая + не-selected новая.) Редактор: `selectedLegKey` из transfer-панели (event/transfer→tr.from/to; create/pick→leftPanel.fromVisit/toVisit.id). Известный мелкий нюанс: road-leg при первом добавлении highlight может быть прямой пока OSRM-кэш не заполнен (flight ок). Репейнт highlight при теме включён.

**Hover города → selected на карте** [доб. 2026-06-17]: CSS `.tmk.is-hover` + `:hover` (desktop-only media) = залитый вид без pulse. `MapView` проп `hoveredVisitId` тогглит классы по `el.dataset.vids` БЕЗ ребилда маркеров (selected тоже переведён на тоггл; `selectedVisitId` убран из deps draw-эффекта). Источники hover: ScreenMap `RouteStepper` (onHover→hoverIdx, обе раскладки) и редактор `te-seamwrap` строки (onMouseEnter/Leave→hoveredNodeId). Наведение на сам пин — чистый CSS.

Чистка: un-export `drawRouteLines` (внутр.) и `cssToken` (внутр.). check:design падает ТОЛЬКО на чужой пре-существующей типографике (CalendarLens.css/GeoAttribution) — не регрессия; цвет report-only.

Мокап-первоисточник: `Triplanio design new/MAP_MARKERS_LINES_LUMO_2026-06-17.html` (только Ring). Осталось: пуш dev+main (пушит Pavel — блок Vercel Hobby на коммиты не-владельца [[triplanio-vercel-hobby-blocks-collaborator-commits]]), живой смоук обеих тем, обновить Notion (карта/дизайн). Связано: [[triplanio-map-singleton]], [[triplanio-overview-screen]].
