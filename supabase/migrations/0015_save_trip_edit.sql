-- Edit Mode full batch-save (TRIP_EDIT_MODE_TZ §6). Persists city structure
-- (dates+position), NEW cities, booking date edits, new transfers and explicit
-- deletes — atomically, while the caller holds the lock; then releases it.
-- Operates BY ID (no wipe+reinsert) so budget_expenses links (source_kind+source_id,
-- kept by the sync_budget_expense trigger) survive — manual budget edits are preserved.
--
-- p_nodes      : [{ id, start_datetime, end_datetime, position }]            (existing city_visits)
-- p_cities_new : [{ tmp, city_name, country, country_code, latitude, longitude,
--                   timezone, external_city_id, kind, start_datetime, end_datetime, position }]
--                inserted; tmp→new id is remapped into transfers_new ends below.
-- p_edits      : { hotels:[{id,check_in_datetime,check_out_datetime}],
--                  activities:[{id,start_datetime,end_datetime}],
--                  transfers_upd:[{id,start_datetime,end_datetime}],
--                  transfers_new:[{from_city_visit_id,to_city_visit_id,start_datetime,end_datetime,transport_type,carrier}] }
--                  (transfers_new ends may be a tmp id of a new city or a real uuid)
-- p_deletes    : { hotels:[id...], activities:[id...], transfers:[id...], cities:[id...] }
--                cities are removed with explicit child deletes (hotels→activities→transfers→city).
drop function if exists public.save_trip_edit(uuid, jsonb, jsonb, jsonb);

create or replace function public.save_trip_edit(p_trip uuid, p_nodes jsonb, p_cities_new jsonb, p_edits jsonb, p_deletes jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_by uuid;
  v_map jsonb := '{}'::jsonb;   -- tmp city id → new uuid (as text)
  v_newid uuid;
  rec record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;
  select editing_by into v_by from trips where id = p_trip for update;
  if v_by is distinct from v_uid then raise exception 'lock not held'; end if;

  p_edits := coalesce(p_edits, '{}'::jsonb);
  p_deletes := coalesce(p_deletes, '{}'::jsonb);

  -- 1) existing city_visits: dates + position
  update city_visits cv set
    start_datetime = nullif(n->>'start_datetime','')::timestamptz,
    end_datetime   = nullif(n->>'end_datetime','')::timestamptz,
    position       = nullif(n->>'position','')::int
  from jsonb_array_elements(coalesce(p_nodes,'[]'::jsonb)) n
  where cv.id = (n->>'id')::uuid and cv.trip_id = p_trip;

  -- 1b) NEW cities → insert, capture tmp → new id
  for rec in select e.value as v from jsonb_array_elements(coalesce(p_cities_new,'[]'::jsonb)) e loop
    insert into city_visits (trip_id, created_by, city_name, country, country_code, latitude, longitude,
                             timezone, external_city_id, kind, start_datetime, end_datetime, position)
    values (p_trip, v_uid, rec.v->>'city_name', rec.v->>'country', rec.v->>'country_code',
            nullif(rec.v->>'latitude','')::float8, nullif(rec.v->>'longitude','')::float8,
            nullif(rec.v->>'timezone',''), nullif(rec.v->>'external_city_id',''),
            coalesce(nullif(rec.v->>'kind',''),'transit'),
            nullif(rec.v->>'start_datetime','')::timestamptz, nullif(rec.v->>'end_datetime','')::timestamptz,
            nullif(rec.v->>'position','')::int)
    returning id into v_newid;
    v_map := v_map || jsonb_build_object(rec.v->>'tmp', v_newid::text);
  end loop;

  -- 2) explicit deletes (bookings)
  delete from hotel_stays where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'hotels','[]'::jsonb)) x);
  delete from activities  where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'activities','[]'::jsonb)) x);
  delete from transfers   where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'transfers','[]'::jsonb)) x);

  -- 2b) removed cities → child deletes then the city
  delete from hotel_stays where trip_id=p_trip and city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);
  delete from activities  where trip_id=p_trip and city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);
  delete from transfers   where trip_id=p_trip and (from_city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x) or to_city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x));
  delete from city_visits where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);

  -- 3) booking date edits (by id → budget links intact)
  update hotel_stays h set check_in_datetime=nullif(e->>'check_in_datetime','')::timestamptz, check_out_datetime=nullif(e->>'check_out_datetime','')::timestamptz
  from jsonb_array_elements(coalesce(p_edits->'hotels','[]'::jsonb)) e where h.id=(e->>'id')::uuid and h.trip_id=p_trip;
  update activities a set start_datetime=nullif(e->>'start_datetime','')::timestamptz, end_datetime=nullif(e->>'end_datetime','')::timestamptz
  from jsonb_array_elements(coalesce(p_edits->'activities','[]'::jsonb)) e where a.id=(e->>'id')::uuid and a.trip_id=p_trip;
  update transfers t set start_datetime=nullif(e->>'start_datetime','')::timestamptz, end_datetime=nullif(e->>'end_datetime','')::timestamptz
  from jsonb_array_elements(coalesce(p_edits->'transfers_upd','[]'::jsonb)) e where t.id=(e->>'id')::uuid and t.trip_id=p_trip;

  -- 4) new transfers — ends may be a tmp id (→ remap) or a real uuid
  insert into transfers (trip_id, created_by, currency, from_city_visit_id, to_city_visit_id,
                         start_datetime, end_datetime, transport_type, carrier)
  select p_trip, v_uid, 'EUR',
    coalesce((v_map->>(e->>'from_city_visit_id'))::uuid, case when (e->>'from_city_visit_id') ~* '^[0-9a-f-]{36}$' then (e->>'from_city_visit_id')::uuid end),
    coalesce((v_map->>(e->>'to_city_visit_id'))::uuid,   case when (e->>'to_city_visit_id')   ~* '^[0-9a-f-]{36}$' then (e->>'to_city_visit_id')::uuid   end),
    nullif(e->>'start_datetime','')::timestamptz, nullif(e->>'end_datetime','')::timestamptz,
    e->>'transport_type', e->>'carrier'
  from jsonb_array_elements(coalesce(p_edits->'transfers_new','[]'::jsonb)) e;

  -- 5) release lock
  update trips set editing_by = null, editing_since = null where id = p_trip;
end; $$;

grant execute on function public.save_trip_edit(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
