---
name: triplanio-tripster-cities-seed
description: TRIP-236 — добавить РФ-города + tripster_slug в cities из фида Tripster; резолв через GeoNames-газеттир, чистка cities, fork-ссылка на слаг
metadata:
  type: project
---

★В РАБОТЕ 2026-07-17 (TRIP-236, ветка `cyrus1/trip-236-rf-horoda-v-cities`, PR ещё нет). Две задачи Pavel: (1) завести РФ-города в `cities`, (2) обогатить все города данными Tripster (пока только `tripster_slug`).

**Контекст.** В проде `cities` = разрежённый affiliate-справочник (не источник гео — гео из `geo_gazetteer`/снапшота `city_visits.name_i18n`). 0 РФ-городов (весь справочник из Viator/GYG, а они по РФ не работают). Ключ идентичности — `geonameid` (100% заполнен, уникален), но **PK физически на `id`** (Pavel решил `id` не трогать — ничего на `cities.id` не ссылается: 0 FK, 0 читателей).

**Источник Tripster** = n8n-вебхук `GET https://n8n.triplanio.com/webhook/tripster_cities` (без авторизации): 942 города (276 РФ + СНГ/выездные), поля `name_ru/name_en/iata/slug/url/tripster_city_id/country_name_en`. Нет geonameid/country_code/lat/lng/tz → добираем из газеттира. Разовый снапшот для сида; периодический синк — отдельно позже.

**Схема (решения Pavel).** Отвергли и «один providers jsonb» (нечитаемо), и links-таблицу, и per-provider таблицы — оставили **плоские колонки как сейчас** (`viator_dest_id`/`getyourguide_id`), добавляем `tripster_slug text` (+ частичный индекс). Гео-колонки `cities` — мёртвый дубль gnames (никто не читает: проверено FE+edge+функции+вьюхи+триггеры), **дропаем `country_code,lat,lng,time_zone,source`**; оставляем `id`(PK)+`updated_at`+`geonameid`+`name_en`+`iata_code`+provider-колонки. Живые читатели `cities`: `viator.js`, `getTripDetails` (select), `tripPayload` (select *), `buildBookingPlatforms` (name_en/iata/dest_id).

**Резолвер Tripster→geonameid** (офлайн read-only против прод-газеттира, результат литералами в миграцию — детерминизм dev==prod): страна `country_name_en`→ISO2 (Intl.DisplayNames + оверрайды: **FR не FX, GB не UK, RS не YU, TR/MM/Macau→MO**); ярус1 точный `asciiname` (норм: unaccent+strip [^a-z0-9]) pop-first — БЕЗОПАСЕН; ярус2 альт-имя через `all_doc @@ plainto_tsquery('simple',...)` pop-first; ярус3 РФ кириллица `name_ru` (translate ё→е). Дедуп `DISTINCT ON (geonameid)` pop-first (Pavel: при коллизии слаг крупнейшего). Итог **910/940 (~97%)**: РФ 263/276, остальные 647/664 (+6 дублей схлопнуто). Хвост ~24 = мелкие/острова → **скип (cities не заводим)**.

**★ГРАБЛИ — fuzzy-ярусы дают мис-мапы, нельзя сидить вслепую:** `search_blob`=пробел-список нормализ. альт-имён → substring-ILIKE ЗАПРЕЩЁН (Балахна→Novaya Balakhna, Плёс→Pskov, Семёнов→Murmansk, Лоо→Beloozyorskiy). Даже FTS+pop-first ловит: **Болхов→Volkhov(472722)**, **Ростов Великий(slug Rostov)→Rostov-on-Don(501175)** (а Rostov-na-Donu в хвост). Вывод: ярус1 сидить смело, **ярусы2/3 (~110 строк) — через верификацию перед сидом**.

**Сделано в коде:** `buildBookingPlatforms.jsx` — Tripster-ссылка `{cityEn}`→`{tripster_slug}` (`visit.cities.tripster_slug`), фолбэк `https://tripster.tpx.lt/FI9cXo6V?erid=2VtzqvY2rSV` (не через tpLink); `getTripDetails/index.ts` — добавлен `tripster_slug` в select. Осталось: миграция (чистка+колонка+сид с верифицир. fuzzy), обновить Notion-доку Tripster (ссылки/слаги), build+lint+test, PR в dev. Fork-модалка целевой URL: `tp.media/r?campaign_id=11&marker=654801&p=652&trs=532202&u=…/experience/{tripster_slug}/`.
