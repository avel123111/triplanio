---
name: triplanio-free-services-risk
description: "«Бесплатные» гео-сервисы в проде (OSRM/Nominatim/OSM-тайлы/Open-Meteo) — у всех есть подвох, прод-путь по каждому"
metadata: 
  node_type: memory
  type: project
  originSessionId: 72bb7051-2a1d-42c7-ab3d-8ae69a72d734
---

Triplanio коммерческий, а гео-стек частично висит на публичных «бесплатных» сервисах. У КАЖДОГО есть ограничение по ToS/нагрузке — сейчас «работает» только из-за низкого трафика. При росте → rate-limit/IP-бан/нарушение лицензии. Front-load это Pavel'у, не «всплывай через месяц».

- **OSRM demo** (`router.project-osrm.org`, routing.js) — без SLA, «not for production», rate-limited. Прод: self-host OSRM (Docker+OSM-экстракт) или платный Directions (Mapbox $2/1k).
- **Nominatim public** (`nominatim.openstreetmap.org`, geo.js searchCities/reverseGeocode) — макс 1 req/s, autocomplete-нагрузка и bulk запрещены, нужен валидный UA/Referer. Прод: self-host Nominatim или платный геокодер.
- **OSM raster-тайлы** (`tile.openstreetmap.org`, Leaflet/AiTripMiniMap) — heavy/commercial use запрещён OSM tile policy. Прод: платный тайл-провайдер (Mapbox/MapTiler) или self-host тайлов.
- **Open-Meteo** (geo.js getTimezone) — free только non-commercial + лимит. Прод: платный план ИЛИ лучше offline tz (`tz-lookup`/`geo-tz`, ноль API).

Вывод: «бесплатно» в проде = либо self-host (DevOps), либо платный вендор (можно консолидировать на Mapbox/MapTiler), либо offline-данные где возможно (таймзоны). Leaflet vs MapLibre — оба бесплатный движок; разница в тайлах (raster vs vector) и в том, что MapLibre = drop-in путь к Mapbox. Связано с [[triplanio-timezone-dedup]].
