---
name: triplanio-city-country-count-unification
description: "Единый источник подсчёта городов/стран трипа (только transit + дедуп), фикс расхождения цифр между хедерами/обзором/карточкой/редактором"
metadata: 
  node_type: memory
  type: project
  originSessionId: ebd3417f-80f9-45f9-818e-73a8b60c0ade
---

★РЕАЛИЗОВАНО 2026-06-16 (build+lint+44 теста зелёные; деплой = только фронт-push в dev и main, БД не трогалась).

**Баг:** число городов/стран расходилось между экранами. Причина — нет единого источника: `uniqueCityCount`/`uniqueCountryCount` считали по ВСЕМ `city_visits` (вкл. start/end/waypoint), а разные вызыватели подавали то сырой список, то предфильтрованный; плюс разный признак уникальности (external_city_id / имя / без дедупа). Только хедер редактора фильтровал transit, но без дедупа повторных заездов.

**Правило (решения Pavel):** считаем ТОЛЬКО `kind === 'transit'` (инклюзивно; null-kind в prod+dev нет — проверено), страны только по transit-городам. Дедуп ВЕЗДЕ по «город+страна» = `city_name(lower)|country_code`; **`external_city_id` в дедупе НЕ участвует** (правка 2026-06-16#2: трип b40704dd имел Москву дважды с разными external_city_id 195713348/196017222 → хедер по id давал 8, карточка по имени 7; решение Pavel — ключ «город+страна», Москва=1 → 7 везде). Страны — по `country_code`.

**Единый источник:** `src/lib/trip-cities.js` — `isTransitVisit`, `transitVisits`, `cityKey` (=`name|cc`), `uniqueTransitCities` (дедуп-набор, представитель = первое вхождение), `uniqueCityCount`=`uniqueTransitCities().length`, `uniqueCountryCount`. И счёт, и подпись городов идут из ОДНОГО набора `uniqueTransitCities` → разойтись не могут. `uniqueCountryCount` перенесена из trip-stats.js (там ре-экспорт). Завязаны: Обзор `TripStatRow/tripStats`, хедер `TripView.jsx:991`, степпер `ScreenMap.jsx:122`, `PublicTrip.jsx:23`, хедер редактора `TripStructureEdit` (`uniqueCityCount(draft.nodes)`; `cities` остался для нумерации стоев), `scopeLabel` в `Trips.jsx` (теперь `uniqueTransitCities`). Тест `src/lib/trip-cities.test.js` (вкл. кейс дубль-Москвы).

**Хедер дат тоже унифицирован (2026-06-16#2):** редактор склеивал `fmtD=toFormat('d MMM')` БЕЗ года → «10 сент. – 4 окт.», обычные экраны через `formatTripRange` → «…2026». Редактор переведён на `formatTripRange(draft.nodes,'-')` (тот же вход, что `visits` в TripView) → идентично. Удалён неиспользуемый `lang` в TripStructureEdit.

**Открыто:** (1) «24 дней» — `dayWord` (n>=2&&n<=4 few, else many) даёт неверный плюрал для 24/22/23 (должно «дня»); нужен модульный плюрал; одинаков в обоих хедерах, так что не рассинхрон, но баг i18n. (2) мёртвый `getTripCountryNames` в tripPreviewMeta.jsx. (3) степпер карты рисует анкер-пиллы, но число transit-only (косметика).

Связано: [[triplanio-overview-screen]], [[triplanio-overview-redesign-todo]], [[feedback_base44_analysis_rule]].
