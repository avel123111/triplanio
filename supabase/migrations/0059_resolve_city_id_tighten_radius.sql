-- 0059 — tighten resolve_city_id match radius 30 km → 12 km.
--
-- resolve_city_id() maps a geocoded coordinate to the nearest row in `cities`
-- (same country preferred). The previous 30 km radius was wide enough to snap a
-- coordinate near a small town onto a larger city up to 30 km away — producing a
-- wrong city_id (wrong Viator activities, wrong city grouping). Tightening to
-- 12 km keeps legitimate centroid offsets (large metros / airports) matchable
-- while rejecting far-away neighbours. Only the radius constant changes; the
-- pre-filter box, same-country preference and ordering are unchanged.
create or replace function public.resolve_city_id(p_country_code text, p_lat double precision, p_lng double precision)
returns bigint
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_id bigint;
  c_radius_km constant double precision := 12;
begin
  if p_lat is null or p_lng is null then
    return null;
  end if;

  select id into v_id
  from (
    select id,
      6371 * acos(least(1, greatest(-1,
        sin(radians(p_lat)) * sin(radians(lat)) +
        cos(radians(p_lat)) * cos(radians(lat)) * cos(radians(lng - p_lng))
      ))) as dist_km,
      (country_code = p_country_code) as same_country
    from cities
    where lat between p_lat - 0.5 and p_lat + 0.5
      and lng between p_lng - 0.5 and p_lng + 0.5
  ) q
  where dist_km <= c_radius_km
  order by same_country desc, dist_km
  limit 1;

  return v_id;
end;
$function$;
