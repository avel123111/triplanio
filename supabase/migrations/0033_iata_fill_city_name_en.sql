-- Extend the city_visits IATA trigger to also fill city_name_en from the
-- authoritative IATA dataset (iata_cities.name_en) for flightable cities when the
-- English name is missing. This makes city_name_en available at creation for the
-- cities that matter for address search / flight links, without threading the
-- value through every FE insert path. Non-flightable cities are resolved lazily
-- via forward search (src/lib/geo.js cityNameEn). Replaces the reverse-geocode
-- approach that produced sub-locality names (Tao/Khok Tum) — see TRIP-142.

create or replace function public.set_iata_city_code()
returns trigger
language plpgsql
as $$
declare
  v_code text;
  v_name_en text;
begin
  begin
    v_code := public.resolve_iata_city(new.city_name_en, new.country_code, new.latitude, new.longitude);
    new.iata_city_code := v_code;

    -- Fill English name from the IATA dataset when missing and a flightable match exists.
    if (new.city_name_en is null or length(trim(new.city_name_en)) = 0) and v_code is not null then
      select name_en into v_name_en from public.iata_cities where code = v_code;
      if v_name_en is not null then
        new.city_name_en := v_name_en;
      end if;
    end if;
  exception when others then
    new.iata_city_code := null;
  end;
  return new;
end;
$$;
