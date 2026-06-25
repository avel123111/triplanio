-- 0027_live_edit_recompute.sql
-- TRIP-126 / Ф1 (TRIP-127): server-authoritative date recompute + per-action RPCs.
--
-- Background: city_visits stores ONLY baked dates (start_date/end_date) + position +
-- kind. There is NO nights/gap column — the client derives nights from the date span
-- and gap from the adjacent incoming transfer's day_change, then re-lays dates
-- (TripStructureEdit.jsx `recompute`/`buildDraft`). This migration ports that formula
-- to Postgres so any structural edit recomputes the chain server-side in one txn.
--
-- Recompute formula (1:1 with client `recompute`):
--   start = prevCursor + gap;  end = start + nights;  cursor = end
--   * nights = max(0, end_date - start_date)  [derived from the stored SPAN; default 1]
--   * gap    = 1 iff the ADJACENT incoming transfer (prev->this) has day_change=true,
--              else 0; the FIRST transit/waypoint in the chain is forced gap 0  [R1]
--   * 'start'/'end' anchor cities keep their own dates (NOT part of the night chain);
--     only their `position` is normalized.
--   * 'waypoint' consumes 0 nights (single date).
--
-- Per-action technique: RPCs make a minimal provisional write that encodes the new
-- intent in the SPAN / membership / order, then call recompute_trip() which re-lays
-- ALL dates deterministically. recompute_trip is idempotent: with base=null it uses
-- the current first-transit start as the anchor, so a no-op edit moves nothing.
--
-- Dependencies verified (dev schema, 2026-06-11):
--   * city_visits: no triggers -> writing dates here has no side effects / no recursion.
--   * transfers: has triggers (sync_budget_expense, notify_booking_added) -> the
--     transfer recompute trigger is INTENTIONALLY deferred to Ф2 (TRIP-128) to keep Ф1
--     side-effect-free; here we only READ transfers.day_change.
--   * trips is NOT touched (avoids its insert-time triggers create_group_chat/seed_budget);
--     trips.start_date stays a fallback as today. Sync of trips.start/end deferred.
--   * removeCity cascade mirrors save_trip_edit exactly: hotel_stays, activities,
--     transfers(from|to), then city_visits  [R2].
--   * _can_edit_trip(p_trip uuid, p_uid uuid) reused as the auth guard.
--
-- NOTE: client will call snake_case RPC names (set_city_nights, set_trip_start_date,
-- add_city, remove_city, reorder_cities). save_trip_edit + the lock are left intact
-- here; their removal is Ф3/Ф5.

-- ──────────────────────────────────────────────────────────────────────────────
-- Core: recompute_trip(p_trip, p_base) — internal, re-lays the whole chain.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_trip(p_trip uuid, p_base date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor  date;
  v_seen    boolean := false;   -- becomes true after the first non-anchor (forces its gap=0)
  v_prev_id uuid := null;       -- previous row in order (incl. anchors) for adjacency
  v_gap     int;
  v_nights  int;
  v_start   date;
  v_end     date;
  rec       record;
begin
  -- Base = explicit (setTripStartDate), else current first transit/waypoint start,
  -- else trips.start_date, else today. Same source-of-truth as client recompute.
  if p_base is not null then
    v_cursor := p_base;
  else
    select cv.start_date into v_cursor
    from city_visits cv
    where cv.trip_id = p_trip and cv.kind not in ('start','end')
    order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
             cv.position nulls last, cv.start_date nulls last, cv.created_at
    limit 1;
    if v_cursor is null then
      select start_date into v_cursor from trips where id = p_trip;
    end if;
    v_cursor := coalesce(v_cursor, current_date);
  end if;

  for rec in
    select cv.id, cv.kind, cv.start_date, cv.end_date,
           (row_number() over (
              order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
                       cv.position nulls last, cv.start_date nulls last, cv.created_at
           ) - 1) as idx
    from city_visits cv
    where cv.trip_id = p_trip
    order by idx
  loop
    -- Anchor cities keep their dates; only normalize position.
    if rec.kind in ('start','end') then
      update city_visits set position = rec.idx, updated_at = now() where id = rec.id;
      v_prev_id := rec.id;
      continue;
    end if;

    -- gap: only the adjacent incoming transfer (prev -> this) counts [R1];
    -- first non-anchor forced to 0.
    v_gap := 0;
    if v_seen and v_prev_id is not null then
      select case when bool_or(t.day_change) then 1 else 0 end
        into v_gap
      from transfers t
      where t.trip_id = p_trip
        and t.from_city_visit_id = v_prev_id
        and t.to_city_visit_id   = rec.id;
      v_gap := coalesce(v_gap, 0);
    end if;

    v_start := v_cursor + v_gap;   -- date + int days
    v_seen := true;

    if rec.kind = 'waypoint' then
      update city_visits
        set start_date = v_start, end_date = v_start, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_cursor := v_start;
    else
      -- nights derived from the stored span (>= 0), default 1 when dates missing.
      v_nights := greatest(0, coalesce((rec.end_date - rec.start_date), 1));
      v_end := case when v_nights > 0 then v_start + v_nights else v_start end;
      update city_visits
        set start_date = v_start, end_date = v_end, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_cursor := v_start + v_nights;
    end if;

    v_prev_id := rec.id;
  end loop;
end;
$$;

revoke execute on function public.recompute_trip(uuid, date) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- set_trip_start_date — single date anchor; re-lays from the given base.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.set_trip_start_date(p_trip uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;
  perform public.recompute_trip(p_trip, p_date);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- set_city_nights — sets the span (nights) of one city; 0 -> waypoint, >0 -> transit.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.set_city_nights(p_city uuid, p_nights int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_trip  uuid;
  v_kind  text;
  v_start date;
  v_n     int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select trip_id, kind, start_date into v_trip, v_kind, v_start from city_visits where id = p_city;
  if v_trip is null then raise exception 'city not found'; end if;
  if not public._can_edit_trip(v_trip, v_uid) then raise exception 'forbidden'; end if;
  if v_kind in ('start','end') then raise exception 'nights not applicable to anchor city'; end if;

  v_n := greatest(0, least(60, coalesce(p_nights, 0)));  -- clamp 0..60 (matches client nudgeNights)
  update city_visits
    set kind     = case when v_n = 0 then 'waypoint' else 'transit' end,
        end_date = coalesce(v_start, current_date) + v_n,   -- encode new span; recompute relays start
        updated_at = now()
  where id = p_city;

  perform public.recompute_trip(v_trip, null);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- add_city — inserts a city at p_index (real uuid returned), default 2 nights/transit.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.add_city(p_trip uuid, p_city jsonb, p_index int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- make room at the insertion index; recompute will renumber cleanly afterwards
  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  -- provisional start = end of current chain (recompute relays it; only span matters)
  v_start := coalesce(
    (select max(end_date) from city_visits where trip_id = p_trip),
    (select start_date from trips where id = p_trip),
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
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- remove_city — app-side cascade (mirrors save_trip_edit) + recompute  [R2].
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
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select trip_id into v_trip from city_visits where id = p_city;
  if v_trip is null then raise exception 'city not found'; end if;
  if not public._can_edit_trip(v_trip, v_uid) then raise exception 'forbidden'; end if;

  delete from hotel_stays where trip_id = v_trip and city_visit_id = p_city;
  delete from activities  where trip_id = v_trip and city_visit_id = p_city;
  delete from transfers   where trip_id = v_trip and (from_city_visit_id = p_city or to_city_visit_id = p_city);
  delete from city_visits where id = p_city;

  perform public.recompute_trip(v_trip, null);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- reorder_cities — set positions from the given order, then recompute.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_cities(p_trip uuid, p_order uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  update city_visits cv
    set position = x.ord - 1, updated_at = now()
  from (select id, ord from unnest(p_order) with ordinality as t(id, ord)) x
  where cv.id = x.id and cv.trip_id = p_trip;

  perform public.recompute_trip(p_trip, null);
end;
$$;

-- Expose the 5 action RPCs to authenticated callers (each self-guards via _can_edit_trip).
revoke execute on function public.set_trip_start_date(uuid, date) from public, anon;
revoke execute on function public.set_city_nights(uuid, int)      from public, anon;
revoke execute on function public.add_city(uuid, jsonb, int)      from public, anon;
revoke execute on function public.remove_city(uuid)              from public, anon;
revoke execute on function public.reorder_cities(uuid, uuid[])    from public, anon;

grant execute on function public.set_trip_start_date(uuid, date) to authenticated;
grant execute on function public.set_city_nights(uuid, int)      to authenticated;
grant execute on function public.add_city(uuid, jsonb, int)      to authenticated;
grant execute on function public.remove_city(uuid)              to authenticated;
grant execute on function public.reorder_cities(uuid, uuid[])    to authenticated;
