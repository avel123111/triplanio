---
name: triplanio-map-singleton
description: "Triplanio: app-wide singleton карты Mapbox (один инстанс на сессию, reparent между экранами) — решение + статус фаз"
metadata: 
  node_type: memory
  type: project
  originSessionId: 95a88682-9f42-41b0-94bb-1f8e41583db2
---

★РЕШЕНИЕ 2026-06-07 (Pavel): карта не должна ре-рендериться при каждом открытии экрана. Делаем ОДИН `mapboxgl.Map` на всю апу/сессию, который «телепортируется» (DOM appendChild) между экранами. Охват = ВСЯ апа, включая create-флоу (выбран максимальный вариант, не trip-scoped).

Почему так: инстанс карты живёт пока жив React-компонент (`new Map` в useEffect([]) → `map.remove()` при unmount). Раньше overview пересоздавал карту при каждом заходе, а map lens висел скрытым (display:none latch) → бывало 2+ живых WebGL-контекста + капали Map Loads. Подробности раскладки экранов см. рассуждения; три отдельных инстанса были: overview→RouteMapCard→MapView, map lens→ScreenMap→MapView, planner→FlowMap (другой компонент).

Границы (важно, Pavel спрашивал): singleton убирает ТОЛЬКО лишние пересоздания внутри одной живой страницы. Не переживает: перезагрузку/новый день/другое устройство/другого юзера — это всегда новый Map Load (живую карту закешировать нельзя, кешируются только тайлы). Смена трипа в рамках сессии — НЕ пересоздаёт (провайдер над роутером). Кросс-сессионную/кросс-юзерскую стоимость на витринных экранах (Overview) решает не singleton, а статичная картинка (Static Images API, кешируется CDN) — отдельный рычаг, ещё не делали.

АРХИТЕКТУРА: `src/lib/map/MapProvider.jsx` (новый) — context над роутером в `App.jsx` (внутри ConfirmProvider, оборачивает Router+Toaster, покрывает и PublicTrip). Лениво создаёт 1 карту в off-screen holder-div, `acquire(slot,scheme)` = appendChild контейнера в слот + resize(rAF), `release(slot)` = парк обратно в holder (с guard «не красть, если новый владелец уже взял»). `useSharedMap()` hook. ИНВАРИАНТ: одновременно смонтирован только ОДИН MapView (иначе дерутся за единственный элемент).

ФАЗА 1 СДЕЛАНА (2026-06-07, dev, build+check:design зелёные, браузер-верификация на Pavel):
- MapView.jsx: init-эффект `new Map/remove` → `acquire/release`; при unmount чистит свои маркеры + слои mv-dashed/mv-solid (инстанс живёт дальше); `ready` сидится из isStyleLoaded (нет флеша спиннера при возврате). Вся draw/focus/projection/theme логика без изменений.
- TripView.jsx: выпилен latch `mapEverShown` + display:none-обёртка; map lens теперь `{shownLens==='map' && <ScreenMap/>}` (условный монтаж — иначе overview+map оба acquire конфликтуют).
- App.jsx: смонтирован `<MapProvider>`.
- Потребители RouteMapCard/ScreenMap/TripStructureEdit/PublicTrip не меняли (тот же API MapView).

ФАЗА 2 СДЕЛАНА (2026-06-07, dev, build+check:design зелёные, браузер на Pavel): FlowMap.jsx переведён на общий инстанс (acquire/release), как MapView. Чистит свои слои flow-dashed/flow-solid + маркеры при unmount; ready/readyRef из isStyleLoaded; на переиспользованном инстансе явно применяет scheme+projection (его theme/proj-эффекты не зависят от ready). FlowMap остаётся ОТДЕЛЬНЫМ компонентом (своя draw-логика по данным home/cities/returnCity/transport), но делит ОДИН инстанс с MapView — компоненты не сливали, слили инстанс. ManualPlanner (manual+AI, /new-trip и /plan-trip-ai) рендерит один FlowMap на роут; переход create→/trip/:id сохраняет карту (провайдер над роутером). Конфликта за единственный элемент нет: planner-роуты и trip-роуты не пересекаются.
ФАЗА 3 СДЕЛАНА (2026-06-07, dev, build+lint+check:design+тесты 32/32 зелёные, браузер на Pavel): вынес общий `src/lib/map/routeLines.js` → `drawRouteLines(map, legs, {dashedId,solidId,dashedColor,solidColor,...})` — единое правило линий (no kind→dashed, flight→geodesic arc, road→straight+OSRM-апгрейд, else→solid) + отмена pending OSRM. MapView и FlowMap теперь только строят свои legs ({from,to,kind}) и зовут хелпер (mv-* ROUTE_COLOR op.4; flow-* MISSING/accent op.5). МАРКЕРЫ НЕ сливал намеренно — разные (нумерация+группировка+клик vs SVG-метки home/return), объединение дало бы ветвление, не ясность. Дублей линий/OSRM больше нет.

ФИКС ФОКУСА (2026-06-07, dev): после singleton фит ломался при переходе между экранами (map→overview слишком близко, overview→map камера высоко). Причина: acquire делал resize() только в rAF, а draw/fit-эффект потребителя отрабатывал раньше в том же flush — fitBounds считал зум по размерам ХОЛСТА ПРЕДЫДУЩЕГО экрана. Фикс: синхронный map.resize() в acquire ДО фита (rAF оставлен подстраховкой). MapProvider.jsx.

ИТОГ: цель «рендерить карту один раз» достигнута полностью (Фазы 1–2); Фаза 3 — дедуп без смены поведения. Осталось вне этой инициативы: статика на витринах (Overview как кешируемая картинка) для кросс-сессионной/кросс-юзерской стоимости — отдельный рычаг, НЕ начат. Notion-док по карте ещё не обновлён.

Связано: [[triplanio-mapbox-migration]], [[triplanio-overview-screen]], [[triplanio-prod-maps-broken-getmapsapikey]], [[triplanio-free-services-risk]].
