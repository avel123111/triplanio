-- 0043_recompute_anchor_first_leg.sql
-- TRIP-126 follow-up: the date chain must account for an OVERNIGHT (day_change) leg
-- LEAVING the `start` city into the first transit/waypoint — including layover
-- waypoints that sit between `start` and the first transit. Until now the chain
-- anchored at the first non-anchor's OWN start_date AND forced that node's gap to 0
-- (0027 [R1]), so a day_change on the start->first leg was structurally ignored: the
-- first city stayed on the DEPARTURE day instead of the ARRIVAL day.
--
-- Fix (single rule, "Variant B" — an overnight leg is a real extra calendar day):
--   * anchor = the DEPARTURE DATE (UTC) of the first leg leaving the `start` city.
--     A stable EXTERNAL anchor that does NOT move on recompute (idempotent), unlike the
--     first city's own start_date (which itself shifts once a gap is applied to it).
--   * the first non-anchor is no longer special-cased: EVERY non-anchor derives its gap
--     from its adjacent incoming transfer's day_change, including the start->first leg.
--   * net effect: an overnight start->first leg pushes the first city +1 (its arrival
--     day) and the whole chain downstream +1 — exactly like an overnight between two
--     mid-trip cities, and symmetric with the finish-anchor +1 already in the client.
--   * fallback anchor (no start-leg transfer: ManualPlanner / AI without times) = first
--     non-anchor's start_date, gap 0 — identical to prior behaviour, no regression.
--
-- UTC note: city dates are counted by UTC calendar day everywhere (client toDT zone utc;
-- day_change reflects the UTC date rollover). The anchor therefore uses
-- (start_datetime at time zone 'UTC')::date, NOT the DB session tz, so the anchor day and
-- the gap can never drift apart.
--
-- Mirrors client lib/tripDates.layoutDates + TripStructureEdit.buildDraft (kept 1:1).
-- recompute_trip still only READS transfers -> no recursion with trg_recompute_transfer.
-- Signatures/grants of the public RPCs are unchanged.

-- ──────────────────────────────────────────────────────────────────────────────
-- _trip_anchor_date — single source of truth for the chain anchor. Reused by
-- recompute_trip (base=null) AND by reorder_cities / remove_city (pin-before-mutate).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public._trip_anchor_date(p_trip uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1) departure day (UTC) of the first leg leaving the `start` city
    (select (t.start_datetime at time zone 'UTC')::date
       from transfers t
       join city_visits sc on sc.id = t.from_city_visit_id and sc.kind = 'start'
      where t.trip_id = p_trip and t.start_datetime is not null
      order by t.start_datetime
      limit 1),
    -- 2) fallback: first non-anchor's own start_date (manual / no-time trips, gap 0)
    (select cv.start_date
       from city_visits cv
      where cv.trip_id = p_trip and cv.kind not in ('start','end')
      order by case cv.kind when 'start' then 0 when 'end' then 2 else 1 end,
               cv.position nulls last, cv.start_date nulls last, cv.created_at
      limit 1),
    -- 3) legacy fallback (unmaintained / NULL across the dataset)
    (select start_date from trips where id = p_trip),
    current_date
  );
$$;
revoke execute on function public._trip_anchor_date(uuid) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- recompute_trip — base from _trip_anchor_date; first non-anchor's gap NO LONGER
-- forced to 0 (the only changes vs 0027; the rest of the chain math is identical).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.recompute_trip(p_trip uuid, p_base date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor  date;
  v_prev_id uuid := null;   -- previous row in order (incl. anchors) for adjacency
  v_gap     int;
  v_nights  int;
  v_start   date;
  v_end     date;
  rec       record;
begin
  -- Base = explicit (set_trip_start_date / pinned reorder|remove) else the shared anchor.
  v_cursor := coalesce(p_base, public._trip_anchor_date(p_trip));

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

    -- gap = 1 iff the ADJACENT incoming transfer (prev -> this) is day_change.
    -- Applies to the FIRST non-anchor too: an overnight start->first leg now counts.
    v_gap := 0;
    if v_prev_id is not null then
      select case when bool_or(t.day_change) then 1 else 0 end
        into v_gap
      from transfers t
      where t.trip_id = p_trip
        and t.from_city_visit_id = v_prev_id
        and t.to_city_visit_id   = rec.id;
      v_gap := coalesce(v_gap, 0);
    end if;

    v_start := v_cursor + v_gap;   -- date + int days

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
-- reorder_cities / remove_city — pin the trip anchor BEFORE mutating (0030 intent),
-- now via _trip_anchor_date so the pin matches the new departure-based anchor.
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

  v_base := public._trip_anchor_date(p_trip);  -- captured BEFORE reposition

  update city_visits cv
    set position = x.ord - 1, updated_at = now()
  from (select id, ord from unnest(p_order) with ordinality as t(id, ord)) x
  where cv.id = x.id and cv.trip_id = p_trip;

  perform public.recompute_trip(p_trip, v_base);
end;
$$;

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

  v_base := public._trip_anchor_date(v_trip);  -- captured BEFORE the delete

  delete from hotel_stays where trip_id = v_trip and city_visit_id = p_city;
  delete from activities  where trip_id = v_trip and city_visit_id = p_city;
  delete from transfers   where trip_id = v_trip and (from_city_visit_id = p_city or to_city_visit_id = p_city);
  delete from city_visits where id = p_city;

  perform public.recompute_trip(v_trip, v_base);
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Recompute trigger: also fire when a transfer's start_datetime changes, since the
-- anchor now reads the start-leg departure day (editing the first flight's time/date
-- must re-anchor the trip). INSERT/DELETE trigger from 0028 is unchanged.
-- ──────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_recompute_on_transfer_upd on public.transfers;
create trigger trg_recompute_on_transfer_upd
after update on public.transfers
for each row
when (old.day_change        is distinct from new.day_change
   or old.from_city_visit_id is distinct from new.from_city_visit_id
   or old.to_city_visit_id   is distinct from new.to_city_visit_id
   or old.start_datetime     is distinct from new.start_datetime)
execute function public.trg_recompute_transfer();
