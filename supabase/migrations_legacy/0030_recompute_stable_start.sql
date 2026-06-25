-- 0030_recompute_stable_start
--
-- TRIP-126 fix: the trip's START DATE must never move on its own — only an explicit
-- set_trip_start_date may change it (product rule). recompute_trip(p_base => null)
-- anchors the chain at the CURRENT first non-anchor's start_date. That's fine for
-- nights/add edits (the first city doesn't move), but reorder_cities and remove_city
-- CAN change which city is first — so anchoring "after the change" let the trip start
-- jump to the newly-first city's old date (a reorder/delete silently shifted the whole
-- trip in the DB). The client optimistic layout already anchors at the fixed trip
-- start, so client and server diverged.
--
-- Fix: capture the current trip start (first non-anchor by current position) BEFORE
-- mutating, and pass it as the explicit base to recompute_trip. Now reordering or
-- deleting cities keeps the trip's first day fixed; cities just re-lay within it.
-- (trips.start_date is unmaintained / NULL across the dataset, so it can't be the
-- anchor source — the first city's start_date is the de-facto trip start.)
--
-- Additive behaviour change to two existing RPCs only; signatures/grants unchanged.

-- ──────────────────────────────────────────────────────────────────────────────
-- reorder_cities — pin the trip start, THEN reposition + recompute.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_cities(p_trip uuid, p_order uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_base date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  -- current trip start = first non-anchor by current position, captured BEFORE reposition
  select cv.start_date into v_base
    from city_visits cv
    where cv.trip_id = p_trip and cv.kind not in ('start','end')
    order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
             cv.position nulls last, cv.start_date nulls last, cv.created_at
    limit 1;

  update city_visits cv
    set position = x.ord - 1, updated_at = now()
  from (select id, ord from unnest(p_order) with ordinality as t(id, ord)) x
  where cv.id = x.id and cv.trip_id = p_trip;

  perform public.recompute_trip(p_trip, v_base);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- remove_city — pin the trip start, THEN cascade-delete + recompute.
-- Deleting the first city pulls the rest UP to the same trip start (start unchanged).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.remove_city(p_city uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_trip uuid;
  v_base date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select trip_id into v_trip from city_visits where id = p_city;
  if v_trip is null then raise exception 'city not found'; end if;
  if not public._can_edit_trip(v_trip, v_uid) then raise exception 'forbidden'; end if;

  -- current trip start, captured BEFORE the delete
  select cv.start_date into v_base
    from city_visits cv
    where cv.trip_id = v_trip and cv.kind not in ('start','end')
    order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
             cv.position nulls last, cv.start_date nulls last, cv.created_at
    limit 1;

  delete from hotel_stays where trip_id = v_trip and city_visit_id = p_city;
  delete from activities  where trip_id = v_trip and city_visit_id = p_city;
  delete from transfers   where trip_id = v_trip and (from_city_visit_id = p_city or to_city_visit_id = p_city);
  delete from city_visits where id = p_city;

  perform public.recompute_trip(v_trip, v_base);
end;
$$;
