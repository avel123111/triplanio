---
name: triplanio-geo-open-questions
description: "Гео-сервисы Triplanio — что уже сменили, какие провайдеры ещё открыты и где планируем менять"
metadata: 
  node_type: memory
  type: project
  originSessionId: 72bb7051-2a1d-42c7-ab3d-8ae69a72d734
---

Статус миграции гео-стека. Связано с [[triplanio-mapbox-migration]], [[triplanio-timezone-dedup]], [[triplanio-free-services-risk]]. ★Сверено с кодом `triplanio_new` @ main (658451a) 2026-06-12.

**ЗАКРЫТО / сделано:**
- **Карта + рендер**: Google Maps JS + Leaflet → **Mapbox GL** ✅ в коде на main (`src/lib/mapbox.js`, MapView/FlowMap/MapProvider, app-wide singleton [[triplanio-map-singleton]]). Стиль НЕ кастомные Studio-светлый/тёмный, а **единый `mapbox://styles/mapbox/standard`** + `lightPreset` day/night — это закрыло старый п.6.
- **Смена темы карты (бывш. п.6)** ✅ ЗАКРЫТО: один Standard-стиль, тема переключается `setConfigProperty('basemap','lightPreset', day|night)` БЕЗ пересоздания карты (`applyBasemapConfig` в mapbox.js).
- **getMapsApiKey / карта-токен**: edge `getMapsApiKey` выпилен, токен build-time `VITE_MAPBOX_TOKEN`; dev сведён в main, на проде ([[triplanio-prod-maps-broken-getmapsapikey]]).
- **Авиа-дуга**: наш `geodesicLine()`, $0 — провайдер не нужен.

**ОТКРЫТО / где ещё меняем провайдера (всё ниже на 2026-06-12 НЕ тронуто, провайдеры те же):**
1. **Поиск городов/адресов/reverse** — гибрид жив: Nominatim (`geo.js` searchCities/reverseGeocode, `nominatim.openstreetmap.org`) + Google Places (адреса, edge `placesAutocomplete`, GOOGLE_MAPS_API_KEY). ПЛАН → один managed с правом хранить координаты: **Geoapify** (предпочт.) или LocationIQ. Провайдер НЕ финализирован.
2. **Хранение координат** — решается выбором геокодера из п.1. НЕ начато.
3. **Маршруты (земля)** — всё ещё **публичный OSRM demo** (`router.project-osrm.org`, `src/lib/routing.js`), ToS-риск. ⚙️ ЧАСТИЧНО: добавлен in-session кеш + dedup инфлайтов (`src/lib/map/routeLines.js` osrmCache/osrmInflight) — раздувание запросов на ре-рендер закрыто, но провайдер не сменён и геометрия не персистится. Решение (прямые линии vs Geoapify vs self-host) НЕ принято.
4. **Таймзоны** — дубль ЖИВ: Open-Meteo (`geo.js` getTimezone, free=non-commercial) + Google Time Zone (`timezone-resolver.js` resolveTimezoneFromCoords + `placesAutocomplete action:'timezone'`). РЕШЕНО → offline **tz-lookup**, но НЕ реализовано (оба вызова ещё в EventEditDialog/ManualPlanner/TripStructureEdit).
5. **GOOGLE_MAPS_API_KEY / placesAutocomplete** — живёт, пока не сделаны п.1 (поиск) и п.4 (tz). После — ключ удаляется полностью (Google OAuth логина не трогается).

**Карта изменений провайдера (итог):** карта Google→Mapbox ✅ (+единый Standard/lightPreset, тема in-place ✅) · поиск Nominatim+Google→Geoapify (план, не начато) · маршруты OSRM→прямые/Geoapify/self-host (открыто; кеш/dedup добавлен) · таймзоны Open-Meteo+Google→tz-lookup (решено, не сделано).
