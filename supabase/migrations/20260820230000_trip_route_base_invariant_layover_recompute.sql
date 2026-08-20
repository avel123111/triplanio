-- Two independent robustness/hygiene steps for the trip date engine, both grounded
-- in the lens-edit audit. No behaviour change for correct data — pure invariant
-- enforcement + a redundant-work collapse.
--
-- ── (1) BASE-DATE INVARIANT: exactly one `start` and one `end` per trip ──────────
-- The trip's base date lives in the `start` anchor's own `start_date`
-- (_trip_anchor_date, TRIP-209). That made the P0 lens-edit bug possible: nothing
-- at the DB layer forbade a SECOND `start`, and with two, _trip_anchor_date would
-- pick a nondeterministic one. The add_city fix closed the code path; these partial
-- unique indexes make a duplicate anchor IMPOSSIBLE at the schema layer — a
-- belt-and-suspenders backstop of the same class, so no future migration/script/bug
-- can reintroduce it. Verified read-only: 0 trips with >1 start or >1 end on prod
-- AND dev, so the indexes build cleanly. Per-trip_id, so copyTrip (a start for the
-- NEW trip_id) is unaffected; no route op changes a row's kind to a second anchor.
create unique index if not exists city_visits_one_start_per_trip
  on public.city_visits (trip_id) where kind = 'start';

create unique index if not exists city_visits_one_end_per_trip
  on public.city_visits (trip_id) where kind = 'end';

-- ── (2) LAYOVER RECOMPUTE: N+1 → 1 ──────────────────────────────────────────────
-- add_layover_transfer inserts N transfer segments in a loop; the per-row AFTER
-- trigger `trg_recompute_transfer` recomputes the WHOLE trip on each one — so an
-- N-segment layover recomputes N times, then once more explicitly at the end (N+1).
-- The final state is already correct (verified: 2 overnight legs → +2), just wasteful.
--
-- Collapse it with a TRANSACTION-LOCAL flag: the RPC raises `triplanio.defer_recompute`
-- while it inserts, the recompute trigger skips those redundant fires, and the RPC's
-- single explicit recompute at the end does the one real pass. `SET LOCAL` is scoped
-- to the RPC's own transaction (never leaks to concurrent writers), and ONLY this
-- trigger honours the flag — the budget-sync trigger (`sync_budget_expense`) and any
-- FK triggers still fire per row, so segment prices reach the budget as before. On the
-- single-transfer path the flag is unset → recompute runs normally (unchanged). This
-- is the only safe way: DISABLE TRIGGER takes a global lock and hits concurrent
-- writers; `session_replication_role=replica` would also skip the budget-sync trigger.
--
-- search_path re-pinned `public, pg_temp` (TRIP-54); SECURITY DEFINER + grants
-- preserved by CREATE OR REPLACE.
create or replace function public.trg_recompute_transfer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare v_trip uuid;
begin
  -- Bulk guard: a multi-row writer (add_layover_transfer) defers per-row recompute
  -- and runs it ONCE itself. Txn-local; unset on every other path → no-op there.
  if coalesce(current_setting('triplanio.defer_recompute', true), 'off') = 'on' then
    return null;
  end if;
  v_trip := coalesce(NEW.trip_id, OLD.trip_id);
  if v_trip is not null then
    perform public.recompute_trip(v_trip, null);
  end if;
  return null;
end;
$$;

-- add_layover_transfer: identical body, plus it raises the defer flag for the span of
-- its inserts so the per-segment recomputes are skipped and only the final explicit
-- `recompute_trip` runs. The flag auto-resets when the RPC's transaction ends.
create or replace function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb, p_actor uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid      uuid := p_actor;
  v_from_pos int;
  v_wp       jsonb;
  v_wp_id    uuid;
  v_ids      uuid[];
  v_seg      jsonb;
  v_i        int := 0;
  v_idx      int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Defer the per-row recompute trigger for this transaction: we recompute ONCE at
  -- the end instead of once per inserted segment (N+1 → 1). Only trg_recompute_transfer
  -- honours this; budget-sync + FK triggers still fire per row.
  set local triplanio.defer_recompute = 'on';

  select position into v_from_pos from city_visits where id = p_from and trip_id = p_trip;
  if v_from_pos is null then raise exception 'from city not found in trip'; end if;

  v_ids := array[p_from];

  for v_wp in select value from jsonb_array_elements(coalesce(p_waypoints, '[]'::jsonb)) as t(value)
  loop
    v_i  := v_i + 1;
    v_idx := v_from_pos + v_i;
    update city_visits set position = position + 1, updated_at = now()
      where trip_id = p_trip and position >= v_idx;
    insert into city_visits (
      trip_id, created_by, external_city_id, geonameid, name_i18n, city_name_en,
      country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''),
      nullif(v_wp->>'geonameid','')::bigint, v_wp->'name_i18n', nullif(v_wp->>'city_name_en',''),
      v_wp->>'country_code',
      nullif(v_wp->>'latitude','')::numeric, nullif(v_wp->>'longitude','')::numeric,
      nullif(v_wp->>'timezone',''), 'waypoint',
      current_date, current_date, v_idx)
    returning id into v_wp_id;
    v_ids := v_ids || v_wp_id;
  end loop;

  v_ids := v_ids || p_to;

  v_i := 0;
  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as t(value)
  loop
    v_i := v_i + 1;
    insert into transfers (
      trip_id, created_by, from_city_visit_id, to_city_visit_id,
      transport_type, day_change, start_datetime, end_datetime,
      carrier, flight_number, from_address, to_address,
      from_latitude, from_longitude, to_latitude, to_longitude,
      booking_reference, booking_url,
      price, currency, documents, notes, details)
    values (
      p_trip, v_uid, v_ids[v_i], v_ids[v_i + 1],
      v_seg->>'transport_type', coalesce((v_seg->>'day_change')::boolean, false),
      nullif(v_seg->>'start_datetime','')::timestamptz, nullif(v_seg->>'end_datetime','')::timestamptz,
      nullif(v_seg->>'carrier',''), nullif(v_seg->>'flight_number',''),
      nullif(v_seg->>'from_address',''), nullif(v_seg->>'to_address',''),
      nullif(v_seg->>'from_latitude','')::double precision, nullif(v_seg->>'from_longitude','')::double precision,
      nullif(v_seg->>'to_latitude','')::double precision, nullif(v_seg->>'to_longitude','')::double precision,
      nullif(v_seg->>'booking_reference',''), nullif(v_seg->>'booking_url',''),
      nullif(v_seg->>'price','')::numeric, coalesce(nullif(v_seg->>'currency',''), 'EUR'),
      coalesce(v_seg->'documents', '[]'::jsonb),
      nullif(v_seg->>'notes',''), '{}'::jsonb);
  end loop;

  -- The one real recompute (per-segment fires were deferred above).
  perform public.recompute_trip(p_trip, null);
end;
$function$;
