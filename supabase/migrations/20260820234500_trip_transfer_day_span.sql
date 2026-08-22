-- Non-binary transfer gap: transfers can now span N days, not just 0/1.
--
-- Model. `transfers.day_change` (boolean = overnight) generalises to
-- `transfers.day_span` (int = the transfer's own duration in LOCAL calendar days,
-- arrival_day - departure_day). recompute_trip reads it as the gap it applies after
-- the previous city's checkout, so a 3-day ferry pushes the next city +3, not +1.
--
-- Derivation stays on the client (where the local wall-clock day is known and matches
-- the previous day_change computation) and the int is STORED — recompute stays a dumb
-- reader, exactly as it read day_change. No timezone math in SQL, so the FE<->SQL date
-- mirror gains no second implementation to keep in parity (the one real fragility of
-- the calculator).
--
-- day_change is DROPPED in this same migration (bottom): backfill day_span = day_change::int
-- runs first, then the recompute/add_layover/copy_trip/trigger are all recreated on
-- day_span, then the column goes. No reader remains — audited across FE, edge functions,
-- reminders, the AI parser, and the bot system prompts (which describe transfers by
-- start_datetime/end_datetime, never day_change). Backfill is day_change::int (NOT
-- recomputed from datetimes): existing trips do not move a single day on deploy; the
-- true multi-day span is written lazily the next time a transfer is edited. That also
-- sidesteps the timezone edge (dev has 4 transfers whose day_change is true but whose
-- UTC dates are the same day — a UTC date-diff backfill would regress them).

alter table public.transfers
  add column if not exists day_span integer not null default 0;

-- Non-negative span, mirroring the input-integrity-in-the-DB convention (TRIP-169).
do $$ begin
  alter table public.transfers add constraint transfers_day_span_nonneg check (day_span >= 0);
exception when duplicate_object then null; end $$;

-- Preserve current behaviour exactly: overnight -> 1, else 0.
update public.transfers set day_span = day_change::int where day_span = 0 and day_change;

-- recompute_trip: gap now = the incoming transfer's day_span (was bool_or(day_change)
-- -> 0/1). Formula start = prev_checkout + gap is unchanged and already N-capable.
-- search_path re-pinned public, pg_temp (TRIP-54).
create or replace function public.recompute_trip(p_trip uuid, p_base date default null::date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
declare
  v_cursor  date;
  v_prev_id uuid := null;
  v_gap     int;
  v_nights  int;
  v_start   date;
  v_end     date;
  rec       record;
begin
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
    if rec.kind = 'start' then
      update city_visits
        set start_date = v_cursor, end_date = v_cursor, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_prev_id := rec.id;
      continue;
    end if;

    if rec.kind = 'end' then
      v_gap := 0;
      if v_prev_id is not null then
        select coalesce(max(t.day_span), 0)
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

    v_gap := 0;
    if v_prev_id is not null then
      select coalesce(max(t.day_span), 0)
        into v_gap
      from transfers t
      where t.trip_id = p_trip
        and t.from_city_visit_id = v_prev_id
        and t.to_city_visit_id   = rec.id;
      v_gap := coalesce(v_gap, 0);
    end if;

    v_start := v_cursor + v_gap;

    if rec.kind = 'waypoint' then
      update city_visits
        set start_date = v_start, end_date = v_start, position = rec.idx, updated_at = now()
      where id = rec.id;
      v_cursor := v_start;
    else
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

-- add_layover_transfer: writes day_span per segment (day_change no longer written).
-- Keeps the TRIP-425 defer-recompute guard from the previous migration.
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
  v_span     int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

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
    -- Span from the segment; fall back to a legacy day_change bool if an older client
    -- still sends only that in the JSON (the COLUMN is gone, this reads the payload).
    v_span := greatest(0, coalesce(nullif(v_seg->>'day_span','')::int,
                                   (coalesce((v_seg->>'day_change')::boolean, false))::int));
    insert into transfers (
      trip_id, created_by, from_city_visit_id, to_city_visit_id,
      transport_type, day_span, start_datetime, end_datetime,
      carrier, flight_number, from_address, to_address,
      from_latitude, from_longitude, to_latitude, to_longitude,
      booking_reference, booking_url,
      price, currency, documents, notes, details)
    values (
      p_trip, v_uid, v_ids[v_i], v_ids[v_i + 1],
      v_seg->>'transport_type', v_span,
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

  perform public.recompute_trip(p_trip, null);
end;
$function$;

-- copy_trip: carry day_span when copying transfers, else copied trips would lose the
-- gap (day_change was copied but not day_span → recompute, now reading day_span, would
-- flatten overnight/multi-day legs on the copy). Body is verbatim from the previous
-- migration except day_span is added next to day_change in the transfers insert+select.
create or replace function public.copy_trip(p_source uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_src     public.trips%rowtype;
  v_details jsonb;
  v_addons  jsonb;
  v_lang    text;
  v_prefix  text;
  v_title   text;
  v_new_id  uuid;
  v_cv_map  jsonb := '{}'::jsonb;
  r         record;
  v_new_cv  uuid;
begin
  if not public.can_create_trip(p_actor) then
    return jsonb_build_object('outcome', 'limit');
  end if;

  select * into v_src from public.trips where id = p_source;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_details := coalesce(v_src.details, '{}'::jsonb);
  v_addons  := v_details -> 'addons';
  if v_addons is not null and jsonb_typeof(v_addons) = 'object' then
    v_addons := coalesce(
      (select jsonb_object_agg(key, value)
         from jsonb_each(v_addons)
        where not public.is_pro_addon(key)),
      '{}'::jsonb
    );
    v_details := jsonb_set(v_details, '{addons}', v_addons);
  end if;

  select language into v_lang from public.users where id = p_actor;
  v_prefix := case v_lang
                when 'ru' then 'Копия: '
                when 'es' then 'Copia de '
                else 'Copy of '
              end;
  v_title := left(
    v_prefix || regexp_replace(v_src.title, '^(Copy of |Копия: |Copia de )+', ''),
    300
  );

  insert into public.trips
    (title, description, cover_image_url, notes, details, is_pro_trip, created_by)
  values
    (v_title, v_src.description, null,
     v_src.notes, v_details, false, p_actor)
  returning id into v_new_id;

  for r in select * from public.city_visits where trip_id = p_source loop
    insert into public.city_visits
      (trip_id, external_city_id, geonameid, name_i18n, city_name_en, country_code,
       latitude, longitude, timezone, start_date, end_date, kind, position, notes, details, created_by)
    values
      (v_new_id, r.external_city_id, r.geonameid, r.name_i18n, r.city_name_en, r.country_code,
       r.latitude, r.longitude, r.timezone, r.start_date, r.end_date, r.kind, r.position, r.notes, r.details, p_actor)
    returning id into v_new_cv;
    v_cv_map := v_cv_map || jsonb_build_object(r.id::text, v_new_cv::text);
  end loop;

  insert into public.hotel_stays
    (trip_id, city_visit_id, name, address, check_in_datetime, check_out_datetime,
     booking_reference, payment_status, price, currency, free_cancellation, free_cancellation_until,
     phone, email, booking_url, latitude, longitude, notes, details, documents, created_by)
  select
    v_new_id,
    case when h.city_visit_id is not null then (v_cv_map ->> h.city_visit_id::text)::uuid end,
    h.name, h.address, h.check_in_datetime, h.check_out_datetime,
    h.booking_reference, h.payment_status, h.price, h.currency, h.free_cancellation, h.free_cancellation_until,
    h.phone, h.email, h.booking_url, h.latitude, h.longitude, h.notes, h.details, '[]'::jsonb, p_actor
  from public.hotel_stays h
  where h.trip_id = p_source;

  insert into public.activities
    (trip_id, city_visit_id, title, start_datetime, end_datetime, location_address,
     location_latitude, location_longitude, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when a.city_visit_id is not null then (v_cv_map ->> a.city_visit_id::text)::uuid end,
    a.title, a.start_datetime, a.end_datetime, a.location_address,
    a.location_latitude, a.location_longitude, a.price, a.currency, a.notes, a.details, '[]'::jsonb, p_actor
  from public.activities a
  where a.trip_id = p_source;

  insert into public.transfers
    (trip_id, from_city_visit_id, to_city_visit_id, transport_type, start_datetime, end_datetime,
     carrier, booking_reference, booking_url, from_address, to_address, from_latitude, from_longitude,
     to_latitude, to_longitude, flight_number, day_span, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when t.from_city_visit_id is not null then (v_cv_map ->> t.from_city_visit_id::text)::uuid end,
    case when t.to_city_visit_id   is not null then (v_cv_map ->> t.to_city_visit_id::text)::uuid end,
    t.transport_type, t.start_datetime, t.end_datetime,
    t.carrier, t.booking_reference, t.booking_url, t.from_address, t.to_address, t.from_latitude, t.from_longitude,
    t.to_latitude, t.to_longitude, t.flight_number, t.day_span, t.price, t.currency, t.notes, t.details, '[]'::jsonb, p_actor
  from public.transfers t
  where t.trip_id = p_source;

  insert into public.trip_services
    (trip_id, kind, name, price, currency, pickup_datetime, dropoff_datetime, details, created_by)
  select
    v_new_id, s.kind, s.name, s.price, s.currency, s.pickup_datetime, s.dropoff_datetime,
    coalesce(s.details, '{}'::jsonb) - 'documents', p_actor
  from public.trip_services s
  where s.trip_id = p_source;

  return jsonb_build_object('outcome', 'ok', 'tripId', v_new_id);
end;
$$;


-- Recompute-on-update trigger fires when the GAP changes — the gap is now day_span.
-- The old WHEN keyed on day_change, which misses a span edit that keeps the overnight
-- flag (e.g. arrival 09-13 -> 09-14: span 2 -> 3, departure unchanged) — only
-- end_datetime moved, so no clause matched and the server left downstream cities stale.
-- Recreated (before the column drop below) keyed on day_span / endpoints.
create or replace trigger trg_recompute_on_transfer_upd
  after update on public.transfers
  for each row
  when (
    (old.day_span         is distinct from new.day_span)
    or (old.from_city_visit_id is distinct from new.from_city_visit_id)
    or (old.to_city_visit_id   is distinct from new.to_city_visit_id)
  )
  execute function public.trg_recompute_transfer();

-- day_change fully retired: no reader remains (recompute/add_layover/copy_trip/trigger
-- all use day_span; FE reads day_span; edge functions never referenced it; the bot
-- system prompts describe transfers by start_datetime/end_datetime, not day_change;
-- reminders + AI parser never touched it). Backfill above ran first, so nothing is lost.
-- ddl-guard: allow-destructive — day_change generalised into day_span (backfilled = day_change::int above); all readers audited across FE/edge/reminders/AI-parser/bot-prompts, 0 index/view/constraint deps.
alter table public.transfers drop column day_change;
