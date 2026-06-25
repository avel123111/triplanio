-- save_trip_edit also persists each existing city's `kind` (transit ↔ waypoint),
-- so toggling a city's nights to 0 (→ waypoint) or back to a stay actually sticks.
-- Everything else identical to 0018. Anchors keep their 'start'/'end' kind because
-- the client sends each node's real kind.
create or replace function public.save_trip_edit(p_trip uuid, p_nodes jsonb, p_cities_new jsonb, p_edits jsonb, p_deletes jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_map jsonb := '{}'::jsonb;
  v_newid uuid;
  rec record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;
  perform 1 from trips where id = p_trip for update;
  if (select editing_by from trips where id = p_trip) is distinct from v_uid then raise exception 'lock not held'; end if;

  p_edits := coalesce(p_edits, '{}'::jsonb);
  p_deletes := coalesce(p_deletes, '{}'::jsonb);

  update city_visits cv set
    start_date = nullif(n->>'start_date','')::date,
    end_date   = nullif(n->>'end_date','')::date,
    position   = nullif(n->>'position','')::int,
    kind       = coalesce(nullif(n->>'kind',''), cv.kind)
  from jsonb_array_elements(coalesce(p_nodes,'[]'::jsonb)) n
  where cv.id = (n->>'id')::uuid and cv.trip_id = p_trip;

  for rec in select e.value as v from jsonb_array_elements(coalesce(p_cities_new,'[]'::jsonb)) e loop
    insert into city_visits (trip_id, created_by, city_name, country, country_code, latitude, longitude,
                             timezone, external_city_id, kind, start_date, end_date, position)
    values (p_trip, v_uid, rec.v->>'city_name', rec.v->>'country', rec.v->>'country_code',
            nullif(rec.v->>'latitude','')::float8, nullif(rec.v->>'longitude','')::float8,
            nullif(rec.v->>'timezone',''), nullif(rec.v->>'external_city_id',''),
            coalesce(nullif(rec.v->>'kind',''),'transit'),
            nullif(rec.v->>'start_date','')::date, nullif(rec.v->>'end_date','')::date,
            nullif(rec.v->>'position','')::int)
    returning id into v_newid;
    v_map := v_map || jsonb_build_object(rec.v->>'tmp', v_newid::text);
  end loop;

  delete from hotel_stays where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'hotels','[]'::jsonb)) x);
  delete from activities  where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'activities','[]'::jsonb)) x);
  delete from transfers   where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'transfers','[]'::jsonb)) x);

  delete from hotel_stays where trip_id=p_trip and city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);
  delete from activities  where trip_id=p_trip and city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);
  delete from transfers   where trip_id=p_trip and (from_city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x) or to_city_visit_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x));
  delete from city_visits where trip_id=p_trip and id in (select x::uuid from jsonb_array_elements_text(coalesce(p_deletes->'cities','[]'::jsonb)) x);

  update hotel_stays h set check_in_datetime=nullif(e->>'check_in_datetime','')::timestamptz, check_out_datetime=nullif(e->>'check_out_datetime','')::timestamptz
  from jsonb_array_elements(coalesce(p_edits->'hotels','[]'::jsonb)) e where h.id=(e->>'id')::uuid and h.trip_id=p_trip;
  update activities a set start_datetime=nullif(e->>'start_datetime','')::timestamptz, end_datetime=nullif(e->>'end_datetime','')::timestamptz
  from jsonb_array_elements(coalesce(p_edits->'activities','[]'::jsonb)) e where a.id=(e->>'id')::uuid and a.trip_id=p_trip;
  update transfers t set
    start_datetime = case when e ? 'start_datetime' then nullif(e->>'start_datetime','')::timestamptz else t.start_datetime end,
    end_datetime   = case when e ? 'end_datetime'   then nullif(e->>'end_datetime','')::timestamptz   else t.end_datetime end,
    day_change     = case when e ? 'day_change'     then coalesce((e->>'day_change')::boolean, false)  else t.day_change end
  from jsonb_array_elements(coalesce(p_edits->'transfers_upd','[]'::jsonb)) e where t.id=(e->>'id')::uuid and t.trip_id=p_trip;

  insert into transfers (trip_id, created_by, currency, from_city_visit_id, to_city_visit_id,
                         start_datetime, end_datetime, transport_type, carrier, day_change)
  select p_trip, v_uid, 'EUR',
    coalesce((v_map->>(e->>'from_city_visit_id'))::uuid, case when (e->>'from_city_visit_id') ~* '^[0-9a-f-]{36}$' then (e->>'from_city_visit_id')::uuid end),
    coalesce((v_map->>(e->>'to_city_visit_id'))::uuid,   case when (e->>'to_city_visit_id')   ~* '^[0-9a-f-]{36}$' then (e->>'to_city_visit_id')::uuid   end),
    nullif(e->>'start_datetime','')::timestamptz, nullif(e->>'end_datetime','')::timestamptz,
    e->>'transport_type', e->>'carrier', coalesce((e->>'day_change')::boolean, false)
  from jsonb_array_elements(coalesce(p_edits->'transfers_new','[]'::jsonb)) e;

  update trips set editing_by = null, editing_since = null where id = p_trip;
end; $$;

grant execute on function public.save_trip_edit(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
