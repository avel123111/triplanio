---
name: triplanio-geocoding-v2-design
description: Геокодинг v2 (TRIP-146) — дизайн перехода LocationIQ→GeoNames, схема, RPC-контракт, решения Pavel, пофазный план
metadata:
  type: project
---

Геокодинг v2 (эпик [[triplanio-status]] / TRIP-146 под зонтиком TRIP-103). Уход
идентичности/поиска города с LocationIQ на локальный **GeoNames-газеттир**
(ключ `geonameid`); `cities` перезаливается как аффилиат-директория по
`geonameid`. Состояние на 2026-06-29: **спайк (TRIP-145) готов на dev**, идём в
реализацию по фазам. Деплой только через CI/CD (правило 12), агент пушит ветку →
PR → dev (мердж Pavel) → он катит на prod. Связано: [[triplanio-geocode-cache]],
[[triplanio-viator-cities-integration]], [[triplanio-ai-city-resolve-directory-en]].

## Два слоя (не путать) — cold/hot split
- **Холодный словарь / резолюционный слой** = таблицы `geo_*` в app-БД (пока в
  том же проекте prod+dev; вынос в отдельный Supabase-проект отложен — связь со
  слоем аффилиата ТОЛЬКО по значению `geonameid`, без кросс-БД-джоинов, переезд
  лёгкий по росту трафика). Все локали имён хранятся **сыро, все языки**.
- **Горячий путь** = снимок на визите (`city_visits`), ограниченный **языками
  интерфейса (en/es/ru)** — крошечный jsonb, печётся ОДИН раз при сохранении.
  Запрет: НЕ джоинить газеттир (~234k газеттир + ~1.7M словарь имён) на каждый
  рендер трипа/статистики с десятками городов.

## Единственная точка доступа поиска — RPC, не raw SQL
Весь поиск/резолв идёт через одну Postgres-RPC; ни фронт, ни AI-батч, ни layover
не пишут SQL. Контракт стабилен (реализацию можно крутить, фронт не трогая):
```
public.search_gazetteer(q text, lang text default 'en', lim int default 10)
  returns table (geonameid bigint, display text, subtitle text,
    country_code text, population bigint, feature_code text,
    lat double precision, lng double precision)
```
Внутри: FTS по токенам (каждое слово как префикс, через AND), транслитерация
кир→лат (тиас→Tías), поля имя ≫ регион/страна (структурный квалификатор «город
страна»), исторические имена понижены (не доминанта), население = вторичный
тай-брейк (не главный ключ). Локализация display/subtitle по `lang`.

## Таблицы газеттира (спайк на dev: суффикс `_test`, помечены throwaway)
- `geo_gazetteer` ← cities500 (geonameid PK, name, asciiname, feature_code,
  country_code, admin1_code, lat/lng, population, timezone, `doc` tsvector).
  На dev: 234 513 строк. Индексы: PK + GIN(doc) + btree(population) +
  (для in-house reverse) GIST(lat,lng).
- `geo_alt_names` ← alternateNamesV2 СЫРЬЁМ, все языки (на dev спайке пока урезан
  до ru/en/es = 128k строк / 3 языка; расширение до всех локалей — ОТДЕЛЬНЫЙ
  ТАСК). Колонки на языки ЗАПРЕЩЕНЫ (Pavel) — один словарь (geonameid, isolanguage).
- `geo_admin1` ← admin1CodesASCII, `geo_country` ← countryInfo (для подписей
  «регион, страна»; их локализованные имена тоже в alt-names по их geonameid).

## Перезалив `cities` = директория по `geonameid` (финал, план Pavel 2026-06-29)
Стройка с нуля, но **таблицу НЕ пересоздаём** (TRUNCATE+INSERT в ту же `cities`) —
иначе теряем RLS-политику `cities_read` (seed-only, TRIP-135) + гранты + identity
`id`. Источники:
- **Viator-фид** `/destinations` type CITY/TOWN/VILLAGE (~2.5k): `name`→`name_en`,
  `viator_dest_id`, центр-координаты. Скрипт `import-viator-destinations.mjs`
  (заменил `enrich-viator-destinations.mjs` — тот матчил по координатам и писал в
  cities, плодя дубли = корень TRIP-69) грузит сырьё в staging `viator_import`,
  НЕ в cities; матч — отдельным SQL.
- **GetYourGuide** (240): снимок `getyourguide_id`+name+cc из текущего cities ДО
  вычистки (staging `gyg_import`).
- **IATA НЕ тащим** — iata-сид (3507) выкидываем; Pavel дообогатит `iata_code` сам
  по необходимости. **`tripster_id` нет** — Tripster/Sputnik8 ходят по `city_name_en`.

Матч (`scripts/cities-rebuild.sql`): Viator — строго **имя через `search_gazetteer`
+ ближайший кандидат в пределах 10 км** → `geonameid` (координаты Viator = центры,
10 км точен; тёзки разводит координата); GYG — имя + country. **Несовпавшие НЕ
заливаются → Pavel на ручной разбор** (нон-сити: парки/регионы/острова, которых
нет в cities500 — структурно). Канонические поля строки (`name_en` = en-altname→
name→asciiname, `country_code`, `lat/lng`, `time_zone`) берём **из газеттира**
(чинит координатный мусор и кривой name_en = заодно TRIP-58). Схлоп дублей —
группировкой по `geonameid` (структурный фикс TRIP-69, ложных слияний ≈0).
**Разделение по правилу 12:** постоянная схема (`unique(geonameid)` partial) — через
МИГРАЦИЮ (CI/CD); перезалив строк + транзиентные staging — руками (данные, TRIP-69).
FK `city_visits_city_id_fkey` **НЕ дропаем** — снимаем ссылки `update city_id=null`
+ `delete from cities` (TRUNCATE запрещён под FK; FK цел = ноль мутаций схемы);
визиты перерезолвим в Phase 5. Staging-таблицы дропаем в конце (PART 3) — без
untracked-схемы. Прокси-замер matcher на dev (source='viator' 1334 — трудное
подмножество): 73% name+10км, схлоп 2.

## Снимок на визите `city_visits` (Phase 2, аддитивно)
- `+ geonameid bigint NULL` — ключ идентичности v2.
- `+ name_i18n jsonb` — снимок дисплея на en/es/ru, печётся при сохранении.
- `city_name_en` **ОСТАВЛЯЕМ** (Pavel «пока не дропаем») — English для
  партнёрских ссылок (= `name_i18n['en']`, билдеры ссылок пока не трогаем).
- `name_en` как отдельную колонку **НЕ заводим** (был бы дубль city_name_en) —
  отвергнуто.
- Дисплей на горячем пути = `name_i18n[lang] || city_name_en || city_name`,
  ноль джоинов на рендер.

## Решения Pavel (этот тред, 2026-06-29)
- TRIP-65 (дедуп статистики по geonameid) — **отдельный таск**, не в этом эпике;
  `name_i18n` для кросс-локального дисплея всплывёт там (хотя колонку заводим уже
  в Phase 2 ради горячего снимка).
- Словарь всех локалей (расширение `geo_alt_names` с 3 языков) — **отдельный таск**.
- `nearest_city(lat,lng)` / in-house reverse карты — **вернуться в конце**
  (Phase 6); пока reverse-клик карты остаётся на LocationIQ.
- Sub-районы/острова (Bali/Denpasar, Brooklyn/NY, Vatican/Rome) — НЕ пред-решаем
  правилом, размечаем на прогонке Phase 3 (confidence-флаг + ревью Pavel).
- AI-батч резолв (`resolveCities`): в RPC передаём то же, что сейчас (name_en +
  country_code); миссы → `geonameid NULL` (как сегодня `city_id NULL`).
- bulk-данные НЕ в миграции-файле (объём): паттерн из спайка — чанкованный
  INSERT (НЕ `COPY` — pgx-wire его не тянет, 08P01), temp-агрегат для doc-build,
  новый таймстамп на каждую миграцию ([[triplanio-bulk-data-migrations-constraints]],
  [[triplanio-migration-naming-drift]]). Данные грузит Pavel по инструкции агента.
- Phase 3 (финал): `cities` строим из **Viator-фид + GYG**, БЕЗ iata-сида (IATA
  Pavel дообогатит сам); TRUNCATE+INSERT в ту же таблицу (сохранить RLS/гранты);
  матч строго имя+10км; несовпавшие → ручной разбор Pavel; визиты осиротают,
  перерезолв в Phase 5; rebuild = SQL-скрипт (данные), не миграция.

## Пофазный план (каждая фаза = ветка → PR → dev → prod)
- **Phase 0** — зафиксировать дизайн в память (этот файл). ✅
- **Phase 2** — аддитив: `city_visits + geonameid + name_i18n`; `cities + geonameid`.
  Только колонки, поведение не меняется, чистый откат. (Phase 1 = слой поиска
  уже готов спайком, переиспользуем как есть; all-locales/nearest_city вынесены.)
- **Phase 3** — перезалив `cities` (TRUNCATE+INSERT в ту же таблицу): источники
  Viator-фид (staging) + GYG (снимок); матч имя+10км → geonameid; хвост → Pavel
  вручную; канон-поля из газеттира; `unique(geonameid)`; IATA не тащим; визиты
  осиротают; пост-свап валидация аффилиат-целостности (деньги, правило 13).
  Артефакты: `scripts/import-viator-destinations.mjs` + `scripts/cities-rebuild.sql`.
- **Phase 4 (КОД готов, PR в dev 2026-06-29)** — фронт+бэк на RPC, аффилиат
  **late-binding по geonameid** (решение Pavel: связь по значению, не по `city_id`
  — город, добавленный в `cities` позже, подхватывается старыми визитами без
  бэкфилла; `city_id` НЕ нужен как ключ аффилиата, разреженную `cities` FK по
  geonameid не покрыть — джойн без FK). Сделано: `geo.js` `searchCities`/
  `resolveCities`→`search_gazetteer` RPC (LocationIQ выпилен из города; reverse/
  адрес остаются на LocationIQ); `search_gazetteer` +`name_i18n` в выдаче (миграция,
  фронт берёт `name_i18n[lang]` и запекает снимок); все city-write пути пишут
  `geonameid`+`name_i18n` (ManualPlanner create, `add_city` RPC редактора,
  `add_layover_transfer` waypoints, copyTrip); аффилиат по geonameid: `viator.js`
  `.eq('geonameid')`, `getTripDetails` добирает `cities` по geonameid (late-bind,
  чисто читающая правка security-fn), `buildBookingPlatforms` не тронут. Дисплей
  городов пока остаётся `city_name` (кросс-локальный показ из `name_i18n` = TRIP-65).
- **Phase 5** — бэкфилл существующих `city_visits` (перерезолв geonameid по
  name_en+country/коорд). Скрипт, гоняет Pavel.
- **Phase 6** — cutover + чистка: выпил LocationIQ из пути поиска/резолва города
  (адрес — оставить); дроп `resolve_city_id`/`set_city_id`(триггер)/
  `resolve_cities_local`; дроп мёртвых колонок `city_visits.city_name`,
  `city_id`/osm, `iata_city_code` (**`city_name_en` НЕ трогаем**); адоптировать
  `geo_*_test` как постоянные (не сносить, снести только `/gntest`); вернуться к
  `nearest_city`/in-house reverse; Notion (правило 10).

## Риски
- Аффилиат = деньги: неверный матч geonameid молча шлёт в чужой город — пост-свап
  валидация + спот-чек обязательны (правило 13).
- In-house reverse: «ближайший по координатам» ≠ «город точки»; фолбэк на
  LocationIQ заложен.
- bulk-load 234k+1.7M через `db push`: только чанк-INSERT, не COPY; doc-build
  через temp-агрегат (иначе таймаут миграции).
- Атрибуция GeoNames (CC BY 4.0) в UI — не забыть на cutover.
- Месячный рефреш GeoNames — отложен (для v1 не блокер).
