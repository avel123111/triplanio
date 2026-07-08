-- TRIP-209 — the trip's base date must have ONE source of truth.
--
-- Symptom: after changing the start date (set_trip_start_date), the next structural
-- op (transfer edit, reorder, city removal) reverted the whole trip to an older day.
--
-- Root cause: _trip_anchor_date derived the base from the START→first-leg transfer's
-- departure datetime FIRST, and never looked at the start anchor's own start_date.
-- recompute_trip / set_trip_start_date write the base into city_visits (start anchor
-- .start_date) but do NOT touch that transfer datetime, so the two drifted apart.
-- Any recompute called with p_base = NULL (the trg_recompute_transfer / reorder path)
-- then re-derived the STALE transfer day and undid the user's explicit start date.
--
-- Fix: read the START anchor's own start_date FIRST — the value the server itself
-- last wrote. This makes recompute idempotent and makes an explicit start-date change
-- stick across later edits. The transfer-departure day and the first transit city's
-- start stay as cold-start fallbacks (anchor has no date yet). Behaviourally, the
-- trip start is now owned by the start-date control; a transfer whose departure day
-- disagrees surfaces as a TR_DEP_DAY warning instead of silently reshuffling dates.
--
-- Metadata-only (no data change). search_path pinned per TRIP-54 (pg_temp last).

create or replace function public._trip_anchor_date(p_trip uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1) Single source of truth: the start anchor's own start_date (written by
    --    recompute_trip / set_trip_start_date). Reading it first keeps the base stable.
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind = 'start' and cv.start_date is not null
      limit 1),
    -- 2) Cold-start fallback: the departure day of the leg leaving the start city.
    (select (t.start_datetime at time zone 'UTC')::date
       from transfers t
       join city_visits sc on sc.id = t.from_city_visit_id and sc.kind = 'start'
      where t.trip_id = p_trip and t.start_datetime is not null
      order by t.start_datetime
      limit 1),
    -- 3) Fallback: the first transit city's start.
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind not in ('start','end')
      order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
               cv.position nulls last, cv.start_date nulls last, cv.created_at
      limit 1),
    current_date
  );
$$;
