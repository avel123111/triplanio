-- Explicit node order tie-breaker (TRIP_EDIT_MODE_TZ §4a).
-- `position` is AUTO-maintained and ALWAYS consistent with chronology (start_datetime);
-- it only disambiguates nodes that share an equal/overlapping day (incl. future kind='waypoint').
-- It is NOT a free user-defined order — sort everywhere by (start_datetime, position).
alter table public.city_visits add column if not exists position int;

-- Backfill: reproduce the CURRENT sortVisits order so that (start_datetime, position)
-- yields exactly today's ordering (start anchor first, then by start, tie-break by end, then id).
-- Guarded by `position is null` so re-running the migration never clobbers maintained values.
with ordered as (
  select id,
         row_number() over (
           partition by trip_id
           order by case kind when 'start' then 0 when 'end' then 2 else 1 end,
                    start_datetime nulls last,
                    end_datetime  nulls last,
                    id
         ) - 1 as pos
  from public.city_visits
)
update public.city_visits cv
   set position = ordered.pos
  from ordered
 where ordered.id = cv.id
   and cv.position is null;

comment on column public.city_visits.position is
  'Auto-maintained order tie-breaker, subordinate to start_datetime. Sort nodes everywhere by (start_datetime, position). Disambiguates nodes sharing a day (incl. future kind=waypoint). Must never contradict chronology.';
