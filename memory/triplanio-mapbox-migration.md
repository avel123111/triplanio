---
name: triplanio-mapbox-migration
description: "Решение — миграция гео-стека Google/OSM → Mapbox (Вариант 1), пофазовый план, сметы по MAU"
metadata: 
  node_type: memory
  type: project
  originSessionId: 72bb7051-2a1d-42c7-ab3d-8ae69a72d734
---

РЕШЕНО Pavel 2026-06-01: уходим с Google + публичных OSM-демо-серверов на **Mapbox** (managed, без self-host). Вариант 1.

**Целевой стек (по сервисам):**
- Карта (MapView + превью ManualPlanner/AiTripPlanner + AiTripMiniMap) → **Mapbox GL JS** (маркеры=наш DOM/SVG, линии=GeoJSON line-layers). Убрать @vis.gl/react-google-maps, leaflet, react-leaflet, edge getMapsApiKey, VITE_GOOGLE_MAPS_KEY.
- Поиск городов/адресов/reverse → **Mapbox** (Search Box Sessions или Temporary Geocoding — выбрать по цене сессии). Убрать Nominatim.
- **Хранение координат** → **Permanent Geocoding** ($5/1k, 0 free; платим только при СОХРАНЕНИИ места, не при поиске). ⚠️ ОТКРЫТО: проверить ToS-пункт «no distribution/sublicense» против публичного шеринга трипов (getPublicTrip) — гейт перед фазой геокодинга.
- Маршруты земля → **Mapbox Directions** ($2/1k, 100k free) + ОБЯЗАТЕЛЬНО кеш геометрии (сейчас fetchOsrmRoute дёргается на каждый рендер без кеша → иначе счёт раздуется). rail→driving как сейчас.
- Авиа-дуга → наш `geodesicLine()` (сейчас мёртвый, оживить), $0.
- Таймзоны → `tz-lookup` офлайн, $0 (см. [[triplanio-timezone-dedup]]).

**Сметы (профиль/MAU: 20 загрузок карты, 10 поисков, 5 сохранений, 8 маршрутов с кешем):**
200 MAU: Google ~$0 / Mapbox ~$5 (Mapbox чуть дороже — Permanent без free). 1k: ~$70 / ~$25. 5k: ~$995 / ~$415. 50k: ~$11.8k / ~$7.7k. Перелом выгоды Mapbox с ~1000 MAU, дальше кратно.

**СТАТУС 2026-06-02 — ФАЗА «КАРТА» РЕАЛИЗОВАНА (код):** все 4 карты (MapView, ManualPlanner preview, AiTripPlanner preview, AiTripMiniMap) переписаны на mapbox-gl; новый `src/lib/mapbox.js` (token/style/fitToPoints/lineFeature/setLineLayer); линии=GeoJSON-слои, дуга=geodesicLine (оживлён), маршруты по-прежнему OSRM (in-session), стиль light-v11/dark-v11. Удалены: пакеты @vis.gl/react-google-maps+leaflet+react-leaflet, edge `getMapsApiKey`, `VITE_GOOGLE_MAPS_KEY`, leaflet css из index.css. Добавлено: mapbox-gl + css в main.jsx + `VITE_MAPBOX_TOKEN` в .env.example. `GOOGLE_MAPS_API_KEY`/placesAutocomplete (поиск+tz) НЕ тронуты. prod build зелёный, мои файлы lint-clean (репо-долг 34 файла — пред-существующий). ЖДЁТ от Pavel: VITE_MAPBOX_TOKEN в оба Vercel + URL-restrict; удалить getMapsApiKey из ОБОИХ Supabase (`supabase functions delete getMapsApiKey`). Поиск/маршруты-провайдер — ещё не начато (Geoapify предполагался, маршруты возможно прямые линии).

**План: Ф0 подготовка (Pavel: аккаунт+привязка карты+pk-токен; я: ToS-проверка, цена Search Box, смета) → Ф1 tz-lookup (бесплатно, без Mapbox) → Ф2 карта → Ф3 поиск+Permanent (гейт ToS) → Ф4 Directions+кеш → Ф5 выкатка dev+main, обе Supabase, доки.** На каждой фазе git-команды. Связано с [[triplanio-free-services-risk]].
