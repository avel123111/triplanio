-- TRIP-146 Phase 6 — eliminate city_visits.city_name (TRIP-65 cutover).
--
-- The localized snapshot `name_i18n` (en/es/ru) is now the single display source
-- for a trip city; `city_name` (a single-locale frozen string) is redundant. We
-- drop it. Display derives `name_i18n[lang] || city_name_en` client-side; dedup
-- keys on geonameid. `user_custom_visits.city_name` is a DIFFERENT table (manual
-- stat places, no gazetteer identity) and is intentionally kept.
--
-- Order: (1) backfill so no row loses its label, (2) re-point the four functions
-- that read/write the column off it, (3) drop. All in one pass.

-- 1. Backfill: guarantee a non-empty display source for every visit before drop.
--    - seed city_name_en from city_name where it is missing;
--    - seed an 'en' name_i18n slot from city_name where the snapshot is empty
--      (the rare pre-v2 legacy rows Phase 5 never re-resolved).
update public.city_visits
   set city_name_en = city_name
 where coalesce(nullif(city_name_en, ''), '') = '' and coalesce(city_name, '') <> '';

update public.city_visits
   set name_i18n = jsonb_build_object('en', city_name)
 where (name_i18n is null or name_i18n = '{}'::jsonb) and coalesce(city_name, '') <> '';

-- 2a. add_city — stop writing the city_name column (geonameid + name_i18n already
--     carry identity + display; city_name_en stays as the partner-link fallback).
create or replace function public.add_city(p_trip uuid, p_city jsonb, p_index integer default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    trip_id, created_by, external_city_id, geonameid, name_i18n, city_name_en,
    country, country_code,
    latitude, longitude, timezone, kind, start_date, end_date, position)
  values (
    p_trip, v_uid, nullif(p_city->>'external_city_id',''),
    nullif(p_city->>'geonameid','')::bigint, p_city->'name_i18n', nullif(p_city->>'city_name_en',''),
    p_city->>'country', p_city->>'country_code',
    nullif(p_city->>'latitude','')::numeric, nullif(p_city->>'longitude','')::numeric,
    nullif(p_city->>'timezone',''), v_kind,
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos)
  returning id into v_id;

  perform public.recompute_trip(p_trip, null);
  return v_id;
end;
$function$;

-- 2b. add_layover_transfer — same: drop city_name from the waypoint insert.
create or replace function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_from_pos int;
  v_wp       jsonb;
  v_wp_id    uuid;
  v_ids      uuid[];
  v_seg      jsonb;
  v_i        int := 0;
  v_idx      int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

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
      country, country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''),
      nullif(v_wp->>'geonameid','')::bigint, v_wp->'name_i18n', nullif(v_wp->>'city_name_en',''),
      v_wp->>'country', v_wp->>'country_code',
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

  perform public.recompute_trip(p_trip, null);
end;
$function$;

-- 2c. sync_budget_expense — the denormalized expense city tag now derives from the
--     snapshot (English) instead of the dropped city_name. budget_expenses.city_name
--     is a separate text column and is unaffected.
create or replace function public.sync_budget_expense()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_kind text; v_syskey text; v_trip uuid; v_amount numeric; v_currency text;
  v_title text; v_city text; v_cat uuid; v_owner uuid; v_src uuid;
begin
  if    TG_TABLE_NAME = 'hotel_stays'   then v_kind:='hotel';    v_syskey:='accommodation';
  elsif TG_TABLE_NAME = 'transfers'     then v_kind:='transfer'; v_syskey:='transport';
  elsif TG_TABLE_NAME = 'activities'    then v_kind:='activity'; v_syskey:='activities';
  elsif TG_TABLE_NAME = 'trip_services' then v_kind:='service';  v_syskey:='services';
  else return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    delete from public.budget_expenses where source_kind = v_kind and source_id = OLD.id;
    return OLD;
  end if;

  v_trip := NEW.trip_id; v_amount := coalesce(NEW.price, 0); v_currency := NEW.currency; v_src := NEW.id;

  if    TG_TABLE_NAME = 'hotel_stays'   then v_title:=NEW.name;  select coalesce(name_i18n->>'en', city_name_en) into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'transfers'     then v_title:=coalesce(NEW.carrier,'Transfer'); select coalesce(name_i18n->>'en', city_name_en) into v_city from public.city_visits where id = NEW.to_city_visit_id;
  elsif TG_TABLE_NAME = 'activities'    then v_title:=NEW.title; select coalesce(name_i18n->>'en', city_name_en) into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'trip_services' then v_title:=NEW.name;  v_city:=null;
  end if;

  perform public.ensure_trip_budget(v_trip);
  select created_by into v_owner from public.trips where id = v_trip;
  select id into v_cat from public.budget_categories where trip_id = v_trip and system_key = v_syskey limit 1;
  if v_cat is null then
    select id into v_cat from public.budget_categories where trip_id = v_trip order by order_index limit 1;
  end if;
  if v_cat is null then return NEW; end if;

  update public.budget_expenses
     set category_id = v_cat, title = v_title, original_amount = v_amount,
         original_currency = coalesce(v_currency,'EUR'), city_name = v_city
   where source_kind = v_kind and source_id = v_src;
  if not found then
    insert into public.budget_expenses
      (trip_id, category_id, title, original_amount, original_currency, source_kind, source_id, city_name, created_by)
    values (v_trip, v_cat, v_title, v_amount, coalesce(v_currency,'EUR'), v_kind, v_src, v_city, v_owner);
  end if;

  return NEW;
exception when others then
  raise warning 'sync_budget_expense failed: %', sqlerrm;
  return coalesce(NEW, OLD);
end $function$;

-- 2d. get_user_travel_stats — trip-sourced points now carry geonameid + name_i18n
--     (client dedups by geonameid, localizes display from the snapshot). A non-null
--     `city_name` is still emitted (English fallback) for back-compat. custom points
--     come from user_custom_visits, which keeps its own city_name and has no snapshot.
create or replace function public.get_user_travel_stats()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_points jsonb; v_trips jsonb; v_transfers int; v_trip_visits jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    select t.id, t.title, t.cover_gradient, t.cover_image_url
    from public.trips t where public.is_trip_participant(t.id)
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.geonameid, cv.name_i18n, cv.city_name_en,
           cv.country_code, cv.latitude, cv.longitude, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object('id',id,'kind','trip','trip_id',trip_id,
      'geonameid',geonameid,'name_i18n',name_i18n,
      'city_name',coalesce(name_i18n->>'en', city_name_en),'country_code',country_code,
      'lat',latitude,'lng',longitude,
      'start_date',start_date,'end_date',end_date)) as arr
    from all_visits where kind='transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object('id',ucv.id,'kind','custom','trip_id',null,
      'geonameid',null,'name_i18n',null,
      'city_name',ucv.city_name,'country_code',ucv.country_code,'lat',ucv.lat,'lng',ucv.lng,
      'start_date',ucv.start_date,'end_date',ucv.end_date)) as arr
    from public.user_custom_visits ucv where ucv.user_id = v_uid
  ),
  trip_visits as (
    select jsonb_object_agg(trip_id::text, rows) as obj from (
      select trip_id, jsonb_agg(jsonb_build_object('kind',kind,
        'geonameid',geonameid,'name_i18n',name_i18n,
        'city_name',coalesce(name_i18n->>'en', city_name_en),
        'country_code',country_code,'start_date',start_date,'end_date',end_date)) as rows
      from all_visits group by trip_id
    ) g
  )
  select
    coalesce((select arr from trip_points),'[]'::jsonb) || coalesce((select arr from custom_points),'[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object('title',mt.title,
      'cover_gradient',mt.cover_gradient,'cover_image_url',mt.cover_image_url,
      'is_pro',public.is_trip_pro(mt.id))) from my_trips mt),'{}'::jsonb),
    coalesce((select count(*) from public.transfers tr where tr.trip_id in (select id from my_trips)),0),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,'transfers_total',v_transfers,'trip_visits',v_trip_visits);
end $function$;

-- 3. Drop the column. Only the four functions above referenced it (verified: no
--    policy, view, index or generated column depends on it).
alter table public.city_visits drop column city_name;
