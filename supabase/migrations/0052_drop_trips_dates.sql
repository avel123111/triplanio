-- 0052_drop_trips_dates.sql
-- Remove the dead trips.start_date / trips.end_date columns.
--
-- Why safe: both columns are 100% NULL in prod and dev and are never written by
-- any RPC, edge function, or migration. create_trip inserts a trip without them;
-- the only writer was copyTrip, which merely propagated NULL (removed in the same
-- change set). They were read only as a last-resort coalesce() fallback inside
-- _trip_anchor_date and add_city; since the stored value is always NULL those
-- branches are unreachable. We drop the fallback branches here, then drop the
-- columns. No view / index / constraint / RLS policy / trigger / matview / FK
-- depends on them (verified via pg_depend, pg_constraint, pg_policy, pg_trigger).

-- 1. Anchor-date helper: drop the (select start_date from trips ...) fallback.
CREATE OR REPLACE FUNCTION public._trip_anchor_date(p_trip uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select (t.start_datetime at time zone 'UTC')::date
       from transfers t
       join city_visits sc on sc.id = t.from_city_visit_id and sc.kind = 'start'
      where t.trip_id = p_trip and t.start_datetime is not null
      order by t.start_datetime
      limit 1),
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind not in ('start','end')
      order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
               cv.position nulls last, cv.start_date nulls last, cv.created_at
      limit 1),
    current_date
  );
$function$;

-- 2. add_city: drop the (select start_date from trips ...) seed fallback.
CREATE OR REPLACE FUNCTION public.add_city(p_trip uuid, p_city jsonb, p_index integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_kind  text;
  v_pos   int;
  v_start date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  v_kind := coalesce(nullif(p_city->>'kind',''), 'transit');
  v_pos  := coalesce(p_index, (select coalesce(max(position), -1) + 1 from city_visits where trip_id = p_trip));

  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  v_start := coalesce(
    (select max(end_date) from city_visits where trip_id = p_trip),
    current_date);

  insert into city_visits (
    trip_id, created_by, external_city_id, city_name, country, country_code,
    latitude, longitude, timezone, kind, start_date, end_date, position)
  values (
    p_trip, v_uid, nullif(p_city->>'external_city_id',''), p_city->>'city_name',
    p_city->>'country', p_city->>'country_code',
    nullif(p_city->>'latitude','')::numeric, nullif(p_city->>'longitude','')::numeric,
    nullif(p_city->>'timezone',''), v_kind,
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos)
  returning id into v_id;

  perform public.recompute_trip(p_trip, null);
  return v_id;
end;
$function$;

-- 3. Drop the dead columns.
ALTER TABLE public.trips DROP COLUMN IF EXISTS start_date;
ALTER TABLE public.trips DROP COLUMN IF EXISTS end_date;
