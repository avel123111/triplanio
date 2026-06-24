---
name: triplanio-prod-maps-broken-getmapsapikey
description: "РЕШЕНО (локально, ждёт push): getMapsApiKey выпилен, карта на Mapbox VITE_MAPBOX_TOKEN; main сведён с dev"
metadata: 
  node_type: memory
  type: project
  originSessionId: fd5712d1-a712-4289-b93f-0ec30529cc13
---

**Исходный баг (2026-06-02):** на prod edge-логи показывали `404 /functions/v1/getMapsApiKey` — `main` (Google Maps) звал функцию, которой нет на prod Supabase → карта = вечный спиннер. Дрейф git↔runtime, см. [[triplanio-deploy-topology]].

**Статус 2026-06-07 — РЕШЕНО кодом (Вариант A из [[triplanio-mapbox-migration]]):**
- `getMapsApiKey` больше НЕТ нигде: ни в `src/`, ни в `supabase/functions/`, ни в списке edge-функций prod/dev (проверено через Supabase MCP). Карта теперь Mapbox GL, токен берётся build-time из `VITE_MAPBOX_TOKEN` (`src/lib/mapbox.js`).
- `origin/main` УЖЕ содержал `src/lib/mapbox.js` с `VITE_MAPBOX_TOKEN` — т.е. токен-зависимость не новая, Vercel-prod её уже использует.
- Mapbox-работа dev (app-wide singleton, см. [[triplanio-map-singleton]]) влита в `main`: локально `dev == main == 0c1cafb`.

**ВАЖНО — ещё НЕ на проде:** мердж сделан локально, НЕ запушен (в песочнице нет GitHub-кред). Прод починится только когда Pavel запушит `main` → Vercel пересоберёт. До пуша prod-карта остаётся в старом состоянии.

Затрагивает MapView/PublicTrip ([[triplanio-frontend-repo]]).
