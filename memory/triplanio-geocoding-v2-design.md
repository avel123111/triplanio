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

## Перезалив `cities` = директория по `geonameid` (НЕ только аффилиат)
Объединение: полное **IATA-покрытие** (как сегодняшний iata-seed ~3507, для
авиа-ссылок Aviasales по `iata_code`) + `viator_dest_id`/`getyourguide_id`/
`tripster_id` где есть. **Пустых IATA не оставляем** (Pavel). Запись через
`ON CONFLICT(geonameid) DO UPDATE` (обогащение) → дубль физически невозможен =
**структурный корневой фикс TRIP-69** (отдельный merge-хелпер НЕ нужен; рантайм
вообще не пишет в cities — seed-only после TRIP-135). `iata_city`/метро-код
берём из Viator/Tripster, НЕ из GeoNames (там airport-коды).

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

## Пофазный план (каждая фаза = ветка → PR → dev → prod)
- **Phase 0** — зафиксировать дизайн в память (этот файл). ✅
- **Phase 2** — аддитив: `city_visits + geonameid + name_i18n`; `cities + geonameid`.
  Только колонки, поведение не меняется, чистый откат. (Phase 1 = слой поиска
  уже готов спайком, переиспользуем как есть; all-locales/nearest_city вынесены.)
- **Phase 3** — перезалив `cities` рядом (staging) → свап (не TRUNCATE вживую);
  матч Viator+Tripster+IATA в geonameid; confidence-флаг; `geonameid` unique на
  свапе; пост-свап валидация целостности аффилиат-ссылок (деньги, правило 13).
- **Phase 4** — фронт `src/lib/geo.js` + UI на RPC: `searchCities`→search_gazetteer
  (ManualPlanner:186, EventEditDialog:71, CitySearch:24); `resolveCities`→RPC
  (ManualPlanner:971, EventEditDialog:938); на выборе пишем geonameid+name_i18n+
  city_name_en+коорд; партнёрские билдеры по geonameid. reverse-клик и
  geocodeAddress пока на LocationIQ. Reuse обёрток geo.js + CitySearch.
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
