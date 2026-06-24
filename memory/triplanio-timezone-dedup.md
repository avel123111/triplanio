---
name: triplanio-timezone-dedup
description: "TODO — выпилить платный Google Time Zone, есть дубль; но Open-Meteo тоже с подвохом → лучше offline-либа"
metadata: 
  node_type: memory
  type: project
  originSessionId: 72bb7051-2a1d-42c7-ab3d-8ae69a72d734
---

TODO (одобрено Pavel 2026-06-01): убрать платный Google Time Zone API из гео-стека.

Дубль: `geo.js → getTimezone()` (Open-Meteo, бесплатно) и `timezone-resolver.js → resolveTimezoneFromCoords()` + `placesAutocomplete action:'timezone'` (Google, платно ~$5/1k) делают одно и то же — резолвят IANA tz по координатам.

**Why:** платим Google за SKU, который не нужен; бесплатный аналог уже в коде.

**How to apply:** удалить `resolveTimezoneFromCoords` и ветку `action:'timezone'` в edge `placesAutocomplete`, перевести вызовы на единый резолвер.

⚠️ НО: Open-Meteo не «бесплатен без условий» — free tier только non-commercial / лимит запросов; Triplanio коммерческий → формально нужен платный план Open-Meteo ЛИБО лучший вариант: **offline-резолв из координат** (`tz-lookup` / `geo-tz`, bundled-данные, ноль внешних вызовов, ноль политик, ноль цены). Это рекомендованный прод-путь, не просто «переключить на Open-Meteo». Связано с [[triplanio-free-services-risk]].
