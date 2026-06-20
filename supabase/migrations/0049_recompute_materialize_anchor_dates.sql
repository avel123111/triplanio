-- 0049_recompute_materialize_anchor_dates.sql
-- TRIP-126 follow-up: the `start`/`end` anchor city_visits rows now MATERIALIZE their
-- own start_date/end_date instead of carrying whatever add_city seeded.
--
-- Why: recompute_trip already DERIVES the chain anchor from the start-leg departure
-- (_trip_anchor_date) and lays out every non-anchor from it. But the anchor ROWS were
-- never written (the start/end branch only normalized `position`), so their stored
-- start_date/end_date stayed at the add_city seed = max(end_date) over the trip = the
-- trip's far END date. The timeline, the start marker and reorder all read the DERIVED
-- anchor day and looked correct; the transfer validator (validation.js TR_DEP_DAY) is
-- the ONE consumer that reads the stored anchor end_date, so it saw the stale far date
-- and raised a false "departure too far from the day of leaving <city>".
-- Repro: add a `start` (or `end`) node after the route already has later-dated cities
-- (e.g. delete old start/finish + re-add the home city) → seed lands on the trip end.
--
-- Fix (single rule, mirrors the client lib/tripDates.layoutDates + applyAdjacencyGaps):
--   * start = v_cursor = the anchor day (departure day of the first leg leaving start).
--     The start->city1 gap moves CITY1 (+1 on an overnight), NOT the start — so the
--     start anchor is written from v_cursor BEFORE any gap and the cursor is not moved.
--   * end   = v_cursor (checkout of the last city) + day_change of the incoming leg into
--     the finish. On an overnight last->finish leg the FINISH itself moves +1.
--   * anchors still consume no nights and do not advance v_cursor.
--
-- recompute_trip still only READS transfers -> no recursion with trg_recompute_transfer
-- (the only city_visits trigger is set_city_id, which never recomputes). Signature and
-- grants are unchanged; this only redefines the body. _trip_anchor_date, reorder_cities,
-- remove_city, add_city, add_layover_transfer and the triggers are untouched and inherit
-- the fix automatically (they all funnel through recompute_trip).

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
    -- START anchor: written to the anchor day itself (v_cursor, pre-gap). The
    -- start->city1 gap belongs to CITY1, so the cursor is NOT advanced here.
    if rec.kind = 'start' then
      update city_visits
        set start_date = v_cursor, end_date = v_cursor, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_prev_id := rec.id;
      continue;
    end if;

    -- END anchor: checkout of the last city (v_cursor) + day_change of the incoming
    -- leg into the finish (the finish moves on an overnight last->finish leg).
    if rec.kind = 'end' then
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
      update city_visits
        set start_date = v_cursor + v_gap, end_date = v_cursor + v_gap, position = rec.idx, updated_at = now()
      where id = rec.id;
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
