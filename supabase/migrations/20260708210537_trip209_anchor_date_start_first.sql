-- TRIP-209 — the trip's base date must have ONE source of truth.
--
-- Symptom: after changing the start date (set_trip_start_date), the next structural
-- op (transfer edit, reorder, city removal — e.g. deleting the start city) reverted
-- the whole trip to an OLDER day.
--
-- Root cause: _trip_anchor_date derived the base from the START→first-leg transfer's
-- departure datetime FIRST, and never looked at the start anchor's own start_date.
-- recompute_trip / set_trip_start_date write the base into city_visits (start anchor
-- .start_date) but NEVER touch that transfer datetime — so the two drift apart. Any
-- recompute called with p_base = NULL (the trg_recompute_transfer / reorder /
-- remove_city path) then re-derived the STALE transfer day and undid the user's
-- explicit start date. That stale transfer datetime is the "memory of the old day".
--
-- Fix: drop the transfer-departure source entirely. The base is the START anchor's
-- own start_date — the value the server itself writes and always sets (add_city seeds
-- it, set_trip_start_date/recompute maintain it, so it is never NULL once cities
-- exist). Fallback: the first transit city's start (trips with no start anchor),
-- else today. No transfer datetime is ever consulted, so nothing can remember a day
-- the user already moved away from. A transfer whose departure disagrees with the
-- leave day now surfaces as a TR_DEP_DAY warning instead of silently reshuffling.
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
    -- Single source of truth: the start anchor's own start_date.
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind = 'start' and cv.start_date is not null
      limit 1),
    -- Fallback for a trip with no start anchor: the first transit city's start.
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind not in ('start','end')
      order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
               cv.position nulls last, cv.start_date nulls last, cv.created_at
      limit 1),
    current_date
  );
$$;
