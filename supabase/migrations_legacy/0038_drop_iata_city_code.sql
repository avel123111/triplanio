-- Drop the denormalized city_visits.iata_city_code column. IATA now lives only on
-- public.cities (read via city_visits.city_id). set_city_id no longer mirrors it.
--
-- ORDER: getTripDetails must already embed cities and derive `iata_city_code` in
-- its response BEFORE this runs, so the frontend keeps receiving the field.
-- (buildBookingPlatforms reads fromVisit.cities.iata_code with a legacy fallback.)

create or replace function public.set_city_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_name_en text;
begin
  begin
    v_id := public.resolve_city_id(new.country_code, new.latitude, new.longitude);

    if v_id is null and new.latitude is not null and new.longitude is not null then
      insert into public.cities (name_en, country_code, lat, lng, source)
      values (nullif(trim(coalesce(new.city_name_en, '')), ''), new.country_code,
              new.latitude, new.longitude, 'manual')
      returning id into v_id;
    end if;

    new.city_id := v_id;

    -- city_name_en backfill (kept); iata mirror removed (column dropped below)
    if v_id is not null then
      select name_en into v_name_en from public.cities where id = v_id;
      if (new.city_name_en is null or length(trim(new.city_name_en)) = 0) and v_name_en is not null then
        new.city_name_en := v_name_en;
      end if;
    end if;
  exception when others then
    new.city_id := null;
  end;
  return new;
end;
$$;

alter table public.city_visits drop column if exists iata_city_code;
