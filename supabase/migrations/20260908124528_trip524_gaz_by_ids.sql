-- TRIP-524: ТРЕТИЙ ВХОД СПРАВОЧНИКА — ПО КЛЮЧУ (`gaz_by_ids`).
--
-- ЗАЧЕМ. У газеттира сегодня два входа: по строке (`search_gazetteer`,
-- `search_gazetteer_batch`) и по координатам (`nearest_cities`). Оба отдают
-- одну и ту же проекцию `gaz_project` в одной и той же форме строки. Входа «по
-- geonameid» нет — и это дыра ровно там, где он нужен: когда идентичность
-- города приезжает КЛЮЧОМ, а не текстом.
--
-- Повод. ИИ-планировщик получает инструмент поиска по этому справочнику и будет
-- возвращать в операциях `geonameid` — то есть ВЫБИРАТЬ город из нашей выдачи,
-- а не называть его словами (TRIP-524, разбор с Pavel 08.09.2026). Пока
-- идентичность едет текстом, промах возможен всегда: мы лишь двигаем
-- вероятность (жёсткий скоуп по стране — TRIP-159 — сдвинул её сильно, но
-- класс жив). Ключ убивает класс.
--
-- Но ключ ОТ МОДЕЛИ — это данные с границы доверия: id может быть выдуман.
-- Поэтому вызыватель обязан по нему СХОДИТЬ В СПРАВОЧНИК, а не поверить на
-- слово. Без этого входа проверка выродилась бы обратно в поиск по имени —
-- то есть ровно в то, от чего уходим.
--
-- ФОРМА ВЫДАЧИ — ТА ЖЕ, ЧТО У ДВУХ ДРУГИХ ВХОДОВ, до порядка колонок: у
-- справочника одна строка результата на все входы, и `mapGazCity` на фронте
-- читает её одним кодом. Проекция — `gaz_project` (локализованное имя, регион +
-- страна подписью, снимок `name_i18n`), не инлайн-копия: копий этих трёх
-- выражений в проекте больше нет с TRIP-226.
--
-- ПОРЯДОК СТРОК = ПОРЯДОК ВХОДА (`with ordinality`), как у batch-резолва: тот
-- же приём, что `ord` в `search_gazetteer_batch`, и по той же причине —
-- вызыватель выравнивает ответ по своему списку позиционно.
--
-- НЕСУЩЕСТВУЮЩИЙ id просто НЕ ВОЗВРАЩАЕТСЯ — строк приходит меньше, чем
-- запрошено. Это и есть проверка: вызыватель сверяет состав, а не ловит
-- исключение. Ошибку выдумывать незачем — «нет такого города» это не сбой.
--
-- Потолок 200 — верхняя граница здравого смысла (в маршруте узлов ≤ 60,
-- `draft.ts`), чтобы один запрос не потянул произвольный кусок справочника.

create or replace function public.gaz_by_ids(_ids bigint[], _lang text default 'en')
returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select g.geonameid,
         p.display, p.subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng,
         p.name_i18n
  from unnest(coalesce(_ids, '{}'::bigint[])) with ordinality as t(id, ord)
  join geo_gazetteer g on g.geonameid = t.id
  cross join lateral public.gaz_project(g.geonameid, _lang) p
  order by t.ord
  limit 200;
$function$;

-- Гранты как у соседних входов справочника (`nearest_cities`,
-- `search_gazetteer_batch`): сначала снять с PUBLIC, затем выдать поимённо.
-- REVOKE именно FROM PUBLIC, а не FROM anon: грант на PUBLIC наследуют все роли,
-- и ревок с одной роли его не снимает (TRIP-49).
revoke all on function public.gaz_by_ids(bigint[], text) from public;
grant execute on function public.gaz_by_ids(bigint[], text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- ВТОРОЕ: БАТЧ-РЕЗОЛВ УЧИТСЯ ОТДАВАТЬ НЕСКОЛЬКО КАНДИДАТОВ (`lim`).
--
-- ЗАЧЕМ. Инструменту ИИ-агента нужен ВЫБОР: он смотрит на кандидатов вместе с
-- их регионом, населением и координатами и берёт того, кто вяжется с соседями
-- по маршруту (Портленд рядом с Бостоном — это Мэн, а не Орегон). Резолверу
-- фронта выбор не нужен: ему нужен один лучший, он и берёт `limit 1`.
--
-- ПОЧЕМУ НЕ ПЯТАЯ ФУНКЦИЯ. У справочника один движок (`search_gazetteer_core`)
-- и обёртки-ВИДЫ ДОСТУПА поверх него: по строке (typeahead), по строкам батчем
-- (резолв), по координатам, по ключу (выше). «Батч + несколько кандидатов» —
-- не новый вид доступа, а ПАРАМЕТР существующего: те же входные имена, тот же
-- скоуп по стране, та же пара «локализованное имя → английский фолбэк». Пятое
-- имя над тем же движком было бы копией с одной изменённой цифрой.
--
-- СОВМЕСТИМОСТЬ. `lim` по умолчанию 1 → при вызове из фронта
-- (`resolveCities` шлёт `{items, lang}`) поведение БАЙТ-В-БАЙТ прежнее: одна
-- лучшая строка на вход, `ord` 1:1, кэп 50 записей. `expandBatchRows` на фронте
-- продолжает читать 0..1 строк на позицию и ничего не знает об этой правке.
--
-- DROP+CREATE, а не CREATE OR REPLACE: добавление параметра меняет СИГНАТУРУ,
-- и `create or replace` завёл бы ВТОРУЮ функцию с тем же именем. Две перегрузки
-- ломают резолв PostgREST (вызов по именам аргументов становится
-- неоднозначным), поэтому старая снимается в той же транзакции миграции.
-- Потолок кандидатов 10 = окно `search_gazetteer_core`; просить больше нечего.
-- ddl-guard: allow-destructive — TRIP-524, контрактная фаза: перегрузка снимается
-- в той же транзакции и тут же пересоздаётся с default-параметром, вызов из
-- фронта (`{items, lang}`) продолжает резолвиться в неё же.
drop function if exists public.search_gazetteer_batch(jsonb, text);

create function public.search_gazetteer_batch(items jsonb, lang text default 'en'::text, lim integer default 1)
 returns table(ord integer, geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with inp as (
    select e.ord::int                                     as ord,
           coalesce(e.item->>'q', '')                     as q,
           coalesce(e.item->>'q_en', '')                  as q_en,
           upper(coalesce(e.item->>'cc', ''))             as cc,
           coalesce(nullif(e.item->>'lang', ''), lang)    as ilang
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality as e(item, ord)
    where e.ord <= 50
  )
  select i.ord, c.geonameid, c.display, c.subtitle, c.country_code,
         c.population, c.feature_code, c.lat, c.lng, c.name_i18n
  from inp i
  cross join lateral (
    select r.geonameid, r.display, r.subtitle, r.country_code,
           r.population, r.feature_code, r.lat, r.lng, r.name_i18n
    from (
      -- src 0 = локализованное имя (язык юзера); src 1 = английское (фолбэк).
      -- core скоупим по стране города (i.cc): кандидаты только из неё.
      select sc.*, 0 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q, i.ilang, 10, i.cc) sc
      where i.q <> ''
      union all
      select sc.*, 1 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q_en, 'en', 10, i.cc) sc
      where i.q_en <> '' and i.q_en <> i.q
    ) r
    order by r.src, r.rn
    limit greatest(1, least(coalesce(lim, 1), 10))
  ) c;
$function$;

revoke all on function public.search_gazetteer_batch(jsonb, text, integer) from public;
grant execute on function public.search_gazetteer_batch(jsonb, text, integer) to anon, authenticated;
