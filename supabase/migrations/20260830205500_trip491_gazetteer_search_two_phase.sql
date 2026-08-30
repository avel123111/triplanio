-- TRIP-491: поиск города падал по statement timeout — трёхфазная форма отбора.
--
-- Sentry TRIPLANIO-21 (`canceling statement due to statement timeout`, 57014,
-- тег `source: gazetteer_search`, culprit `/new-trip`, 14 случаев за 10 дней).
--
-- ── Что было сломано ────────────────────────────────────────────────────────
-- `search_gazetteer_core` применял LIMIT ПОСЛЕДНИМ, а проекция `gaz_project`
-- (6 подзапросов на город) и латераль `nn` висели на КАЖДОМ кандидате. На вводе
-- `sa` кандидатов 20 398 — раскрашивались все, отдавались 12: 6 625 мс при лимите
-- 8 с у роли `authenticated`. Разброс цены ×2800 между `sa` (11 269 мс на один
-- символ) и `barcelona` (4 мс). Индексы при этом здоровы: BitmapAnd = 65 мс,
-- 0,05% времени. Порог входа — ввод короче 3 символов; клиент режет 1 символ,
-- дебаунс 300 мс срабатывает на огрызках («mo», «moo») → 2-символьные запросы
-- реально уходят в БД. Разработчик вводит название целиком и всегда попадает
-- в дешёвую ветку — поэтому дефект не ловился на своих прогонах.
--
-- Ещё два расхода сидели НЕ в проекции, а в КЛЮЧЕ СОРТИРОВКИ (он тоже считался
-- на всех 20 398 строках, и это то, что пропустил первичный анализ):
--   • `log((population+1)::numeric)` — логарифм над numeric, ~500 мс;
--   • `case when g.name_doc @@ t.q_name` — ПОВТОРНЫЙ матч tsvector после того,
--     как bitmap-скан этот же предикат уже применил, ~350 мс.
--
-- ── Форма решения ──────────────────────────────────────────────────────────
-- Проекция уходит ЗА отсечку. Образец не изобретён: `nearest_cities` (TRIP-226)
-- в этом же файле-дереве уже устроена так — `gaz_project` там поверх CTE с LIMIT.
--
--   Ф1 `by_name` / `by_blob` — дешёвый отбор кандидатов ДВУМЯ ветками.
--      Несущее: внутри ветки `name_bonus` — КОНСТАНТА, поэтому скор монотонен по
--      населению и `order by population desc limit 200` = top-200 по скору. Из
--      ключа сортировки исчезают И повторный tsvector-матч, И логарифм: ветка
--      сортирует по голой колонке. Корректность: итоговый top-`lim` обязан лежать
--      внутри объединения веток (любая строка принадлежит хотя бы одной, а внутри
--      своей ветки упорядочена по населению), 200 — запас на бонусы `nn` (≤1.5).
--   Ф2 `ranked` — полное ранжирование ~350 кандидатов ТОЙ ЖЕ формулой (здесь
--      и только здесь нужен `nn`, т.е. поход в `geo_alt_names`).
--   Ф3 — `gaz_project` ровно для финальных `lim` строк.
--
-- `log(float8)` вместо `log(numeric)`: в Postgres `log(double precision)` — тот же
-- десятичный логарифм, значения те же, цена в разы меньше.
--
-- Замер на проде (`sa`, прогретый кэш): 6 625 → 970 (проекция за отсечку)
-- → 452 (float8-логарифм) → 129 мс (расщепление на ветки). ≈45×.
--
-- ── Что НЕ меняется ────────────────────────────────────────────────────────
-- Сигнатура, тип возврата, формула ранжирования, тир exact-first под `cc`,
-- фильтр feature_code, `gaz_project` — дословно как были. Схема и справочник не
-- трогаются, фронт не трогается. `create or replace` сохраняет владельца и ACL
-- (core не публична с 20260709121207); revoke ниже — та же защитная строка, что
-- в 20260716161512, чтобы инвариант «core внутренняя» был виден в диффе.
--
-- `search_gazetteer_batch` НЕ правится намеренно: он зовёт это же ядро (до 100 раз
-- в одном стейтменте — 50 элементов × локализованное + английское имя), и чинится
-- тем же изменением. Сегодня одно короткое имя от ИИ роняло по таймауту резолв
-- ВСЕГО маршрута, а не одну строку. Опускать там `lim` с 10 до 1 смысла нет:
-- после этой правки цена ядра определяется отсечкой в 200, а не `lim`.
--
-- ── Гейт приёмки (прогнан на проде ДО этой миграции) ───────────────────────
-- Дифф выдачи живой и новой логики: 58 запросов, 57 побайтово идентичны.
-- Покрыты 2-символьные en+ru (`sa`,`mo`,`ba`,`br`,`st`,`ne`,`мо`,`са`,`кр`,`ни`),
-- полные имена, мультитокен, `cc`-скоуп и оба кейса TRIP-159 (Vík í Mýrdal под IS,
-- Переславль под RU). Единственное расхождение — `sevilla`/es: пара строк
-- «Sevilla» с population 0 и РАВНЫМ счётом 4.500000. Порядок между ними
-- сегодняшний ORDER BY не задаёт (тайбрейкера после `population desc` нет), два
-- вызова текущей функции тоже могут дать разный порядок. Это существующая
-- недетерминированность, а не регресс; детерминированный тайбрейкер сюда
-- НЕ добавлен намеренно — он изменил бы сегодняшнюю выдачу, а задача этой
-- миграции — не менять её вообще.
--
-- ── Известный остаток (отдельной фазой, не здесь) ──────────────────────────
-- Все замеры — на ПРОГРЕТОМ кэше. Таблица 588 МБ, и двухветочный отбор трогает
-- БОЛЬШЕ heap-блоков, чем один скан (6 571 + 9 043 = 15 614 против 9 043), т.е.
-- на холодном кэше выигрыш меньше замеренного. Лечится частичными индексами по
-- населению («горячий» отбор + фолбэк на полный, если недобрал `lim`): для `sa`
-- это 35 964 → 4 814 кандидатов. Катить только после замера на dev с холодным
-- кэшем — вслепую нельзя.

create or replace function public.search_gazetteer_core(q text, lang text default 'en'::text, lim integer default 10, cc text default ''::text)
 returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with nq as (
    select trim(regexp_replace(lower(unaccent(coalesce(q,''))), '[^a-z0-9а-яё]+', ' ', 'g')) as qn
  ),
  arr as (select qn, regexp_split_to_array(qn, ' ') as a from nq where qn <> ''),
  t as (
    select qn,
           public.translit_ru_lat(qn)    as qn_lat,
           a[1]                           as first_tok,
           public.translit_ru_lat(a[1])   as first_lat,
           to_tsquery('simple', '(' || a[1] || ':* | ' || public.translit_ru_lat(a[1]) || ':*)') as q_name,
           to_tsquery('simple', nullif(array_to_string(array(
             select '(' || e || ':* | ' || public.translit_ru_lat(e) || ':*)'
             from unnest(a) e where e <> ''
           ), ' & '), '')) as q_all
    from arr
  ),
  -- Ф1. Совпало САМО имя (в формуле это бонус 3.0). Бонус внутри ветки —
  -- константа ⇒ порядок по скору == порядок по населению ⇒ сортируем по голой
  -- колонке, без tsvector-матча и без логарифма в ключе.
  by_name as (
    select g.geonameid, 3.0::float8 as name_bonus
    from t
    join geo_gazetteer g
      on g.name_doc @@ t.q_name
     and g.all_doc  @@ t.q_all
    where t.q_all is not null
      and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
      and (nullif(cc,'') is null or g.country_code = upper(cc))
    order by g.population desc nulls last
    limit 200
  ),
  -- Ф1. Совпало только в blob (склейка альт-имён на всех языках) — бонуса нет.
  by_blob as (
    select g.geonameid, 0.0::float8 as name_bonus
    from t
    join geo_gazetteer g
      on g.blob_doc @@ t.q_name
     and g.all_doc  @@ t.q_all
    where t.q_all is not null
      and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
      and (nullif(cc,'') is null or g.country_code = upper(cc))
    order by g.population desc nulls last
    limit 200
  ),
  -- Строка может попасть в обе ветки; берём больший бонус — ровно то, что дал бы
  -- `case when name_doc @@ q_name` на объединённом наборе.
  cand as (
    select u.geonameid, max(u.name_bonus) as name_bonus
    from (select * from by_name union all select * from by_blob) u
    group by u.geonameid
  ),
  -- Ф2. Полная формула — на ~350 кандидатах вместо 20 000. `nn` = имя города на
  -- языке зрителя (фолбэк на `g.name`); единственное место, где нужен поход
  -- в geo_alt_names до отсечки.
  ranked as (
    select c.geonameid,
           g.country_code, g.population, g.feature_code, g.lat, g.lng,
           (case when nullif(cc,'') is not null and (nn.nm = t.qn or nn.nm = t.qn_lat) then 0 else 1 end) as exact_tier,
           c.name_bonus
         + 1.0 * (case when nn.nm = t.qn or nn.nm = t.qn_lat then 1 else 0 end)
         + 0.5 * (case when nn.nm like t.first_tok||'%' or nn.nm like t.first_lat||'%' then 1 else 0 end)
         + 1.2 * log((coalesce(g.population,0) + 1)::float8) as score
    from cand c
    join geo_gazetteer g on g.geonameid = c.geonameid
    cross join t
    left join lateral (
      select regexp_replace(lower(unaccent(
               coalesce((select an.alternate_name from geo_alt_names an
                          where an.geonameid = c.geonameid and an.isolanguage = lang
                          order by an.is_preferred desc nulls last limit 1), g.name))),
             '[^a-z0-9а-яё]+', ' ', 'g') as nm
    ) nn on true
    order by exact_tier, score desc, g.population desc nulls last
    limit lim
  )
  -- Ф3. Раскрашиваем ровно то, что отдаём.
  select r.geonameid,
         p.display,
         p.subtitle,
         r.country_code, r.population, r.feature_code, r.lat, r.lng,
         p.name_i18n
  from ranked r
  cross join lateral public.gaz_project(r.geonameid, lang) p
  order by r.exact_tier, r.score desc, r.population desc nulls last;
$function$;

-- Инвариант security-tiers: ядро внутреннее, клиенту недоступно. Публичны только
-- обёртки search_gazetteer / search_gazetteer_batch (SECURITY DEFINER, исполняются
-- под владельцем). `create or replace` ACL не трогает — строка идемпотентна
-- и повторяет 20260716161512, чтобы инвариант был виден в диффе.
revoke all on function public.search_gazetteer_core(text, text, integer, text) from public;
