-- ============================================================================
-- TRIP-146 Phase 3 — перезалив public.cities как директории по geonameid.
--
-- DATA-операция (по конвенции TRIP-69 — НЕ миграция-файл): гоняет Pavel под
-- service_role / в SQL-редакторе, на dev и prod отдельно. Структуру cities НЕ
-- пересоздаём (сохраняем RLS-политику cities_read + гранты + identity id) —
-- только вычищаем строки и заливаем заново.
--
-- ИСТОЧНИКИ: Viator-фид (staging viator_import, заливает import-viator-
-- destinations.mjs) + GetYourGuide (снимок из текущего cities). IATA НЕ тащим
-- (Pavel дообогатит сам). Tripster/Sputnik8 id не имеют (ходят по name_en).
--
-- КЛЮЧ ИДЕНТИЧНОСТИ — geonameid. Матч строго: имя через search_gazetteer +
-- координата в 10 км. Несовпавшие НЕ заливаются — идут Pavel на ручной разбор.
--
-- ПОРЯДОК (между частями — внешние шаги, не пропускать):
--   PART 0  — создать staging (viator_import пустой + снимок gyg_import).
--   [внешне] node scripts/import-viator-destinations.mjs <env>  — залить Viator.
--   PART 1  — резолв + ОТЧЁТ (НЕ деструктивно). Прочитать хвост, разобрать с Pavel.
--   PART 2  — сборка + свап строк cities (ДЕСТРУКТИВНО). Только после ревью хвоста.
--   [позже] Phase 5 — перерезолв city_visits (осиротевших) на новый cities.
-- ============================================================================


-- ======================= PART 0 — staging ==================================
-- viator_import: сырьё фида (заполняет node-скрипт). Транзиентная, дроп в Phase 6.
create table if not exists public.viator_import (
  viator_dest_id text primary key,
  name           text,
  lat            double precision,
  lng            double precision,
  time_zone      text,
  iata           text,
  dest_type      text
);
-- default-deny RLS (конвенция TRIP-46: public-таблица без RLS читается anon через
-- PostgREST; service_role/ETL не задет, политик не даём — staging транзиентный).
alter table public.viator_import enable row level security;

-- gyg_import: снимок GYG-идентификаторов из ТЕКУЩЕГО cities ДО его вычистки.
drop table if exists public.gyg_import;
create table public.gyg_import as
  select getyourguide_id, name_en, country_code
  from public.cities
  where getyourguide_id is not null;
alter table public.gyg_import enable row level security;

-- >>> STOP: запусти node scripts/import-viator-destinations.mjs <env> <<<
-- (заполнит public.viator_import свежим Viator CITY/TOWN/VILLAGE)


-- ======================= PART 1 — резолв + отчёт (НЕ деструктивно) ==========
-- Резолв Viator: имя через search_gazetteer + ближайший кандидат в пределах 10 км.
drop table if exists public.viator_resolved;
create table public.viator_resolved as
select vi.viator_dest_id, vi.name, vi.lat, vi.lng, m.geonameid, m.km
from public.viator_import vi
left join lateral (
  select s.geonameid,
         6371*acos(least(1, greatest(-1,
           sin(radians(vi.lat))*sin(radians(s.lat))
           + cos(radians(vi.lat))*cos(radians(s.lat))*cos(radians(vi.lng - s.lng))))) as km
  from public.search_gazetteer(vi.name, 'en', 20) s
  where 6371*acos(least(1, greatest(-1,
           sin(radians(vi.lat))*sin(radians(s.lat))
           + cos(radians(vi.lat))*cos(radians(s.lat))*cos(radians(vi.lng - s.lng))))) <= 10
  order by km asc
  limit 1
) m on true;
alter table public.viator_resolved enable row level security;

-- Резолв GYG: имя + страна (Pavel: достаточно). Берём крупнейший одноимённый в стране.
drop table if exists public.gyg_resolved;
create table public.gyg_resolved as
select gi.getyourguide_id, gi.name_en, gi.country_code, m.geonameid
from public.gyg_import gi
left join lateral (
  select s.geonameid
  from public.search_gazetteer(gi.name_en, 'en', 20) s
  where s.country_code = gi.country_code
  order by s.population desc nulls last
  limit 1
) m on true;
alter table public.gyg_resolved enable row level security;

-- --- ОТЧЁТ (прочитать перед PART 2) ---
select 'viator_total'        k, count(*)::text v from public.viator_import
union all select 'viator_matched',   count(*)::text from public.viator_resolved where geonameid is not null
union all select 'viator_unmatched', count(*)::text from public.viator_resolved where geonameid is null
union all select 'viator_collapse_groups(>1 dest→1 geonameid)',
  (select count(*)::text from (select geonameid from public.viator_resolved where geonameid is not null group by 1 having count(*)>1) s)
union all select 'gyg_total',        count(*)::text from public.gyg_import
union all select 'gyg_matched',      count(*)::text from public.gyg_resolved where geonameid is not null
union all select 'gyg_unmatched',    count(*)::text from public.gyg_resolved where geonameid is null;

-- Хвост Viator на ручной разбор (имя + координата → почему не нашёлся):
--   select name, lat, lng from public.viator_resolved where geonameid is null order by name;
-- Хвост GYG:
--   select getyourguide_id, name_en, country_code from public.gyg_resolved where geonameid is null order by name_en;

-- >>> STOP: разобрать хвосты с Pavel. Принятые ручные маппинги дописать в
--     viator_resolved/gyg_resolved (set geonameid=...) ДО PART 2. <<<


-- ======================= PART 2 — сборка + свап строк (ДЕСТРУКТИВНО) ========
-- Запускать ТОЛЬКО после ревью хвоста. Одной транзакцией.
begin;

-- Осиротить визиты (city_id повиснет; перерезолв — Phase 5).
alter table public.city_visits drop constraint if exists city_visits_city_id_fkey;

-- Вычистить строки (структура/RLS/гранты/identity сохраняются).
truncate table public.cities;

-- Залить директорию: одна строка на geonameid, канонические поля из газеттира,
-- провайдеры схлопнуты (ближайший Viator-dest на geonameid + GYG).
insert into public.cities (geonameid, name_en, country_code, lat, lng, time_zone,
                           viator_dest_id, getyourguide_id, source)
select gz.geonameid,
       coalesce(en.alternate_name, gz.name, gz.asciiname)            as name_en,
       gz.country_code,
       gz.lat, gz.lng, gz.timezone,
       v.viator_dest_id,
       y.getyourguide_id,
       case when v.viator_dest_id is not null and y.getyourguide_id is not null then 'viator+gyg'
            when v.viator_dest_id is not null then 'viator'
            else 'getyourguide' end                                  as source
from (
  select geonameid from public.viator_resolved where geonameid is not null
  union
  select geonameid from public.gyg_resolved    where geonameid is not null
) ids
join public.geo_gazetteer_test gz on gz.geonameid = ids.geonameid
left join lateral (
  select alternate_name from public.geo_alt_names_test
  where geonameid = ids.geonameid and isolanguage = 'en'
  order by is_preferred desc nulls last limit 1
) en on true
left join lateral (
  select viator_dest_id from public.viator_resolved vr
  where vr.geonameid = ids.geonameid order by vr.km asc limit 1
) v on true
left join lateral (
  select getyourguide_id from public.gyg_resolved gr
  where gr.geonameid = ids.geonameid limit 1
) y on true;

-- geonameid становится уникальным ключом директории.
create unique index if not exists cities_geonameid_key on public.cities(geonameid);

commit;

-- --- пост-свап валидация (security, правило 13 — аффилиат = деньги) ---
-- select count(*) cities, count(distinct geonameid) uniq,
--        count(*) filter (where viator_dest_id is not null) with_viator,
--        count(*) filter (where getyourguide_id is not null) with_gyg
-- from public.cities;
-- Спот-чек известного: select name_en, country_code, viator_dest_id from public.cities where geonameid = 360630; -- Cairo
