---
name: triplanio-geocode-cache
description: TRIP-145 P1 — серверный кэш геокодинга LocationIQ (geocode_cache); LocationIQ = итоговый геокодер; направление P2/P3
metadata: 
  node_type: memory
  type: project
  originSessionId: 0817e703-f236-4644-b92c-27aa42cbec61
---

★РЕАЛИЗОВАНО 2026-06-16 (P1 задеплоено prod+dev, ждёт живого смоук-теста). Задача Jira **TRIP-145** «Геокодинг (LocationIQ): кэш + серверный троттл + серверный резолв».

**★★СВЕРКА ПО ФАКТУ 2026-06-20 (репо/БД/Vercel/edge) — P2 ПОЛНОСТЬЮ ЖИВОЙ, прошлый коммент «ждёт деплоя» устарел:**
- Edge `geoLocationiq` **задеплоен в обоих** проектах: version 8, ACTIVE, verify_jwt=true, одинаковый ezbr_sha256, содержимое = полный P2. Token-bucket реально тратится/пополняется (prod tokens≈4, dev дробные). `take_geocode_token(p_min,p_rate,p_cap)` SECURITY DEFINER + `geocode_rate_bucket` есть в обоих.
- Прод-фронт с P2 **в продакшене** (Vercel triplanio_app, prod-деплой с main PR#80 READY). Мой первый вывод «не выкачен» был ошибкой из-за устаревшего локального origin/main (последний fetch 18.06) — НЕ доверять origin-ref без свежего fetch (в sandbox fetch падает: нет GitHub-auth) — проверять Vercel MCP.
- Аудит всех точек геокода: ВСЁ строго через единый `geoLocationiq` (search/resolveCities/reverse/geocodeAddress/autocomplete); ни один другой edge геокодер напрямую не зовёт → бакет/кэш общий на всю систему. Клиент централизован в geo.js; прямой invoke вне него только AddressAutocomplete.jsx (autocomplete, 250мс debounce+stale-guard). Приоритет: interactive(p_min=1) для autocomplete/ручного поиска, background(p_min=2) для AI-батча/адресов броней — полосы уже есть.
- Сделано по ходу: удалил 3 протухшие `autocomplete`-строки в prod-кэше (dev был чист) → кэш = только search+reverse фактически; удалил мёртвую ветку `tag` в `geocodeQueryKey` (репо, косметика, ждёт следующего деплоя geoLocationiq — отдельный редеплой не нужен).
- Скоуп: **upstream-429 отдельным счётчиком в Sentry → вынесено в TRIP-161** (Relates TRIP-145).
- **★Сегментные адреса мульти-leg РЕАЛИЗОВАНЫ 2026-06-20** (Pavel сказал «да делай»): переиспользован существующий `geocodeAddress` (не копия), house-level→коорд иначе текст. Правки: `makeSegment` (+from/to_lat/lng), `handleTransferExtract` мульти-leg (Promise.all по уникальным адресам сегментов, дедуп), `saveLayoverChain` (прокид координат в jsonb), миграция `0047_layover_transfer_segment_coords.sql` = RPC `add_layover_transfer` пишет коорд в transfers (**применена в dev+prod через MCP**, миграции таблицы НЕ было — колонки уже были). Lint/53 теста/build(в /tmp) зелёные. ЖДЁТ: git push dev+main (Pavel; Vercel авто). Edge НЕ трогали. Пины адресов на картах пока не рисуются (как у отеля/одиночного) — отдельный follow-up.
- **Мёртвый код (флаг):** `extraSegments` в EventEditDialog (insert ~792–814 + UI ~1889) — `setExtraSegments` только `[]`, парсер не наполняет → путь не исполняется. Кандидат на удаление.

**Решения сессии (Pavel):**
- Объём: сейчас **только P1 (кэш)**; P2/P3 — отдельными итерациями.
- Провайдер: **LocationIQ — итоговый геокодер**. Это отменяет/откладывает для геокодинга старый план миграции на Mapbox из [[triplanio-mapbox-migration]] (карта осталась на Mapbox, а поиск/резолв городов — LocationIQ). P2-троттл строим прямо под LocationIQ.
- P2 (деградация) и P3 (где резолв) — отдал на моё архитектурное решение (см. ниже).

**Что сделано (P1):**
- Миграция `0035_geocode_cache.sql` → таблица `public.geocode_cache(id, action, query_key, lang, results jsonb, hit_count, created_at, last_used_at)`, `unique(action,query_key,lang)`, RLS **on без политик** (доступ только из edge под service-role). Применена вручную через MCP в **оба** проекта (prod `tizscxrpuopobgcxbekf` + dev `nydhzevdizkfaxdlikgc`).
- Edge `geoLocationiq` (verify_jwt=true, НЕ в canon-10): перед upstream читает кэш по `action+query_key+lang`; **hit** → отдаёт `{results}` без похода наружу + best-effort bump `hit_count/last_used_at`; **miss** → вызов LocationIQ, на 200 (включая 404→`[]`) upsert в кэш; на 502/429/ошибке **в кэш НЕ пишет** (защита от отравления транзиентным rate-limit). Форма ответа `{results}` не изменилась → клиентские вызыватели (`src/lib/geo.js liq()`, `AddressAutocomplete`) без правок.
- Ключ: search/autocomplete = `lower(trim(collapse_ws(q)))` (+ `|tag:` для autocomplete); reverse = `lat.toFixed(5),lon.toFixed(5)`. `lang` отдельно в ключе (имена локализованы). `results` — сырой LocationIQ-массив, нормализация остаётся на клиенте в geo.js.
- Деплой: prod+dev version 3, идентичный ezbr_sha256, verify_jwt=true сохранён. build/lint/44 теста зелёные (build падал только на rmdir смонтированной ФС — окруж., не код).
- Клиентские ретраи (`liq()` backoff, `resolveAiCity`) **оставлены** — после кэша почти не срабатывают; их чистка = P4.

**Открыто (живой смоук-тест):** не мог дёрнуть функцию без user-JWT из сессии. Pavel: открыть планнер → AI-трип → города резолвятся, в `geocode_cache` появляются строки.

**Направление P2/P3 (НЕ в коде):**
- **P2 деградация:** `429 + Retry-After` + клиентский ретрай с джиттером, НЕ серверный sleep (edge stateless, биллинг по wall-clock). Token-bucket — таблица/функция в Postgres (шаред-стейт, не in-memory). С кэшем до ведра почти не доходит.
- **P3 резолв:** один **переиспользуемый серверный примитив** батч-резолва (отдельный edge `resolveCities` либо `action:'resolveCities'` в geoLocationiq), через который проходят ВСЕ точки добавления городов (AI-планнер, ручной, будущие — Pavel: точек будет больше). НЕ вшивать в `planTripWithAi`. Это убирает herd и риск дублирования нормализации «выбрать лучший город» (сейчас живёт только в клиентском geo.js searchCities).

**★★P2 РЕАЛИЗОВАН В КОДЕ 2026-06-19 (lint зелёный, тесты 52/52, build компилируется exit 0; typecheck/check:design — только пред-существующий шум). Миграция `0041` применена в dev+prod через MCP (аддитивная, простаивает до деплоя функции). ЖДЁТ: деплой edge `geoLocationiq` в оба проекта (CLI бандлит `_shared`, verify_jwt=true сохранить+сверить) + git push в dev и main (делает Pavel — Vercel Hobby блочит коммиты не-владельца).** Файлы: миграция `0041_geocode_token_bucket.sql`; `geoLocationiq/index.ts` (троттл+resolveCities+geocodeAddress+Sentry, autocomplete/geocodeAddress НЕ кэшируются); `geo.js` (mapCity/refineCities вынесены, +resolveCities/+geocodeAddress/+isHouseLevel); `ManualPlanner` (applyAiDraft→1 батч, resolveAiCity→shapeAiCity); `EventEditDialog` (handleHotelExtract async+геокод адреса, single-leg from/to геокод, layover→resolveCities+advisory); i18n `validation.AI_LAYOVER_UNRESOLVED` (en/es/ru); попутно убран мёртвый импорт Camera в ReadOnlyTimelineView. Параметры бакета в SQL-дефолтах (rate=2, cap=5, фон p_min=2). TRIP-160 (джиттер клиентского ретрая) — отдельно, ещё не сделан.

**★P2 ПЛАН СОГЛАСОВАН 2026-06-19, файл `Triplanio docs/TRIP-145_P2_PLAN_2026-06-19.md`:**
- Кэш ТОЛЬКО `search`(города)+`reverse`; `autocomplete` из кэша убрать; адреса броней — отдельным НЕкэшируемым действием `geocodeAddress` (не загрязнять city-кэш).
- Серверный sleep в edge ОК (исправил себя: Supabase billing за вызов, НЕ за wall-clock; async-ожидание не ест 2с CPU-лимит). Токен-бакет = таблица `geocode_rate_bucket`(1 строка)+`take_geocode_token(p_min,p_rate,p_cap)` SECURITY DEFINER, миграция `0041`, rate=2/с cap=4–5.
- Приоритет интерактив>фон через `p_min` (интерактив=1 вычерпывает до 0; фон=2 оставляет запас). Автокомплит приоритетнее (решение Pavel).
- Батч `resolveCities` (планнер N→1 + дедуп) делит city-namespace с `search`; ManualPlanner.applyAiDraft (послед. цикл ~954–962) → 1 вызов. Поправка: батч НЕ «убирает залп» (планнер уже резолвит последовательно) — выигрыш latency/invocations/дедуп; кросс-юзерную конкуренцию держит ведро (батч+бакет = дополнение, не замена).
- Адреса AI-парсинга: координаты ТОЛЬКО при house-level match (`isHouseLevel`), иначе адрес текстом без координат/без точки (подтв. Pavel). Модель уже держит lat/lng (отель/трансфер).
- Layover-фикс (EventEditDialog ~957–966): тихий null → `resolveCities`+advisory.
- Наблюдаемость: `_shared/sentry.ts` уже в 14 функциях, в geoLocationiq НЕТ — подключить (счётчик 429/исчерпание ведра).
- Debounce/min-length в AddressAutocomplete УЖЕ есть (250мс/2); опц. 350мс/3.
- **★ОТКРЫТО (ждёт ответа Pavel):** B — координаты адреса отеля/трансфера сейчас НИ ОДНА карта не рисует (ScreenMap/MapView/FlowMap/RouteMapCard = только города `visits.latitude`). Рек: P2 только СОХРАНЯЕТ координаты, рендер пинов = отдельный follow-up.
- Клиентский ретрай `liq()` фикс.backoff `[0,600,1200]` БЕЗ джиттера = retry-storm → вынесен в **TRIP-160** (Relates TRIP-145).

Связано: [[triplanio-free-services-risk]] (кэш+троттл — переиспользуемый паттерн для Nominatim/OSRM/Open-Meteo), [[triplanio-mapbox-migration]], [[triplanio-geo-open-questions]], [[feedback-design-for-scale-not-now]], [[triplanio-deploy-verify-jwt]].
