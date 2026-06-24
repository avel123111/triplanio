---
name: triplanio-ai-city-resolve-directory-en
description: Triplanio AI-трип резолв городов — директория-сначала + EN-имена + self-heal; минимизация нагрузки на LocationIQ; корень rate-limit ещё открыт
metadata: 
  node_type: memory
  type: project
  originSessionId: 0fa0458d-64cd-4d3a-bc94-21e81149910a
---

★РЕАЛИЗОВАНО В КОДЕ 2026-06-23 (БД на prod+dev живо; edge/FE/n8n/git — деплой за Pavel). Задача: AI-генерация трипа лила ~120 холодных гео-запросов на 1 бесплатный ключ LocationIQ (2 req/s) и часть городов не резолвилась.

ДИАГНОЗ (по логам+коду): два РАЗНЫХ симптома одной жалобы «город без координат».
- Sentry `geocode batch had unresolved items` (geoLocationiq/index.ts ~стр.245, action=resolveCities, count=15, env=development) = НЕ «имя не найдено», а **throttle**: `degraded=true` только при `item.failed` в `resolveBatchItem` = токен-бюджет исчерпан или 429/5xx после 2 ретраев. Честный 404→`[]`→`failed:false` (Sentry не триггерит, тихо кэшится n_results=0). Корень — token-bucket `take_geocode_token` rate=2/cap=2, у каждого батча дедлайн 20с, 8 параллельных генераций × 15 = ~120 лукапов >> 40 за окно → две трети «сдаются». Ретраи НЕ лечат degraded (мгновенный фейл) и не тот рычаг.
- Кириллический 404: AI отдавал `city_name` (ru-транслит «трежер-бич»), Nominatim мелкие города в ru не знает → manual-город без координат/viator.

РЕШЕНИЕ (минимизация, не корень): резолвить EN-имя по локальному справочнику `cities` ДО геокодера.
- БД миграция `0064_resolve_cities_local.sql` (применена напрямую prod+dev): `resolve_cities_local(jsonb)` — батч-матч по `lower(unaccent(name_en))`+`upper(country_code)`, отдаёт coords+viator/gyg/iata или null; `learn_city(name_en,cc,lat,lng)` — self-heal #4, идемпотентный upsert `source='locationiq'` (гейт: name+cc+coords). Оба `grant ... to service_role`. `cities`≈4862, 100% coords; европейские хиты ~100%, мелкая Ямайка частично (Treasure Beach/Negril мимо→EN-LocationIQ→self-heal).
- edge `geoLocationiq` ветка resolveCities: (C) 1 RPC `resolve_cities_local` на батч→хиты синтезируются в LIQ-row `directoryRow` (external_city_id=`dir:<id>`, FE refineCities/mapCity без изменений), LocationIQ только промахи EN-именем; (#4) `learn_city` fire-and-forget на успешный резолв; fail-open. Контракт {results,degraded} тот же.
- FE: `src/lib/geo.js resolveCities(items,lang)` принимает объекты `{city_name,name_en,country,country_code}` (строки тоже→backward-compat для EventEditDialog), шлёт EN-имя+cc, gen-запрос lang='en'; `ManualPlanner.jsx` applyAiDraft резолвит по `city_name_en`, shapeAiCity+3 сохранения несут `city_name_en`. Ru-имя сохраняется из AI (не из геокодера) — локализация не меняется.
- n8n «AI Trip Planner» (U9nM2nTiIkYk6g9O, прокси `planTripWithAi`→Railway webhook, ОДИН инстанс на prod+dev): добавить `city_name_en` в Structured Output schema (required) + промпт (англ. экзоним, не транслит) + Validate Draft фолбэк `city_name_en ||= city_name`. Pavel применяет сам.
- Верификация: lint чистый, vite build ok, 65/65 тестов; RPC проверен реальным батчем (Rome/Montego Bay хит, Treasure Beach/Negril null, trim+unaccent ok).

ДЕПЛОЙ-ОСТАТОК (Pavel): `supabase functions deploy geoLocationiq` на nydhzevdizkfaxdlikgc+tizscxrpuopobgcxbekf (verify_jwt=true, НЕ canon-10); git add по одному пути → push dev+main; n8n правки. Порядок безопасен (до n8n FE шлёт пустой name_en→старое поведение).

КОРЕНЬ — выбран FIFO (Pavel 2026-06-23, против моей рекомендации «сначала измерить»; принято). РЕАЛИЗОВАНО В КОДЕ: миграция `0065_geocode_fair_queue.sql` (применена prod+dev) — таблица `geocode_queue`(id bigserial, priority int[1=interactive/2=background], enqueued_at) + RPC `geocode_enqueue`/`geocode_serve_fair`/`geocode_dequeue`. `geocode_serve_fair` под `FOR UPDATE` бакета: refill как у `take_geocode_token` (least(cap,tokens+elapsed*rate), rate2/cap2), обслуживает ТОЛЬКО голову очереди (order priority asc,id asc → interactive впереди, FIFO внутри), TTL-зачистка >60с (>макс.дедлайн 20с, живой не сметается). edge `geoLocationiq`: `takeToken`→`enqueueTicket`/`serveTicket`/`dequeueTicket`, `acquireToken`=тикет→poll до головы+токена или дедлайна→на сдачу dequeue; всё fail-open. `take_geocode_token` оставлен (edge больше не зовёт). Проверено: SQL-асерты (FIFO/preempt/empty-bucket), lint+65 тестов. ВАЖНО: FIFO даёт честность под конкуренцией, но потолок 2req/s и edge-wall-clock НЕ поднимает — под большим всплеском хвост всё равно degraded (детерминированно). Для единичной генерации эффект мал. Деплой edge — за Pavel (с 0064). Связь [[triplanio-geocode-cache]] [[triplanio-viator-cities-integration]].

ОТЛОЖЕНО к концу сессии (просьба Pavel): #5 засорение `geocode_cache` ru-автокомплитом (каждый keystroke/опечатка = строка, 53/56 нулевых), #3 пустая атрибуция user_id/trip_id в `ai_usage_events` (process=trip_planner).
