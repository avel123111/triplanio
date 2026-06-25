-- IATA city codes (TRIP feature): reference table + per-visit code + resolver.
--
-- iata_cities is seeded (one-off) from the TravelPayouts cities dataset, filtered
-- to has_flightable_airport=true. city_visits.iata_city_code is resolved on insert
-- (and when coords / city_name_en change) by a trigger calling resolve_iata_city.
-- Matching: exact (name_en + country_code) when unique, else nearest within 25 km
-- (same-country preferred). Returns NULL when nothing matches (not every place has
-- a flightable IATA city code).

-- 1) Reference table (public, read-only data) ------------------------------------
create table if not exists public.iata_cities (
  code           text primary key,
  name_en        text not null,
  country_code   text not null,
  lat            double precision not null,
  lng            double precision not null,
  time_zone      text
);

create index if not exists iata_cities_name_cc_idx on public.iata_cities (lower(name_en), country_code);
create index if not exists iata_cities_lat_idx on public.iata_cities (lat);
create index if not exists iata_cities_lng_idx on public.iata_cities (lng);

alter table public.iata_cities enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='iata_cities' and policyname='iata_cities_read') then
    create policy iata_cities_read on public.iata_cities for select using (true);
  end if;
end $$;

-- 2) Per-visit code --------------------------------------------------------------
alter table public.city_visits
  add column if not exists iata_city_code text;

-- 3) Resolver --------------------------------------------------------------------
-- SECURITY DEFINER so the trigger can read the reference table regardless of the
-- caller's RLS. STABLE: pure lookup. Never raises.
create or replace function public.resolve_iata_city(
  p_name_en text,
  p_country_code text,
  p_lat double precision,
  p_lng double precision
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
  v_exact_count int;
begin
  -- (a) exact name_en + country_code, only when unambiguous (single hit)
  if p_name_en is not null and length(trim(p_name_en)) > 0 and p_country_code is not null then
    select count(*) into v_exact_count
    from iata_cities
    where lower(name_en) = lower(p_name_en) and country_code = p_country_code;

    if v_exact_count = 1 then
      select code into v_code
      from iata_cities
      where lower(name_en) = lower(p_name_en) and country_code = p_country_code
      limit 1;
      return v_code;
    end if;
  end if;

  -- (b) nearest within 25 km (bounding-box prefilter + haversine), same country first
  if p_lat is not null and p_lng is not null then
    select code into v_code
    from (
      select code,
        6371 * acos(least(1, greatest(-1,
          sin(radians(p_lat)) * sin(radians(lat)) +
          cos(radians(p_lat)) * cos(radians(lat)) * cos(radians(lng - p_lng))
        ))) as dist_km,
        (country_code = p_country_code) as same_country
      from iata_cities
      where lat between p_lat - 0.5 and p_lat + 0.5
        and lng between p_lng - 0.5 and p_lng + 0.5
    ) q
    where dist_km <= 25
    order by same_country desc, dist_km
    limit 1;
    return v_code; -- may be null
  end if;

  return null;
end;
$$;

-- 4) Trigger: set iata_city_code on insert / coord / name change -----------------
-- Never blocks the write: any failure leaves iata_city_code null.
create or replace function public.set_iata_city_code()
returns trigger
language plpgsql
as $$
begin
  begin
    new.iata_city_code := public.resolve_iata_city(
      new.city_name_en, new.country_code, new.latitude, new.longitude);
  exception when others then
    new.iata_city_code := null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_city_visits_iata on public.city_visits;
create trigger trg_city_visits_iata
before insert or update of latitude, longitude, city_name_en on public.city_visits
for each row execute function public.set_iata_city_code();
