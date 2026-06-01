-- Edit Mode: concurrency lock + structure batch-save RPCs (TRIP_EDIT_MODE_TZ §3, §6).
-- SECURITY DEFINER (bypass RLS) but every entry point enforces membership:
-- the caller must be the trip owner OR an active non-viewer member (mirrors the
-- client gate canEditMode = myRole !== 'viewer').

create or replace function public._can_edit_trip(p_trip uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trips t where t.id = p_trip and t.created_by = p_uid)
      or exists (
        select 1 from trip_members m
        where m.trip_id = p_trip and m.user_id = p_uid
          and coalesce(m.role, '') <> 'viewer'
          and coalesce(m.status, 'active') = 'active'
      );
$$;

-- Take the lock if free or its TTL (30 min) has expired. Returns {ok, editing_by, editing_since}.
create or replace function public.acquire_trip_lock(p_trip uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_by uuid; v_since timestamptz;
  v_ttl interval := interval '30 minutes';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  select editing_by, editing_since into v_by, v_since from trips where id = p_trip for update;
  if v_by is not null and v_by <> v_uid and v_since is not null and v_since > now() - v_ttl then
    return jsonb_build_object('ok', false, 'editing_by', v_by, 'editing_since', v_since);
  end if;

  update trips set editing_by = v_uid, editing_since = now() where id = p_trip;
  return jsonb_build_object('ok', true, 'editing_by', v_uid, 'editing_since', now());
end; $$;

-- Keep the lock alive (~5 min interval from the client). No-op if not the holder.
create or replace function public.heartbeat_trip_lock(p_trip uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update trips set editing_since = now() where id = p_trip and editing_by = auth.uid();
end; $$;

-- Release the lock. No-op unless the caller holds it.
create or replace function public.release_trip_lock(p_trip uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update trips set editing_by = null, editing_since = null where id = p_trip and editing_by = auth.uid();
end; $$;

-- Persist structure changes (city dates + position) atomically; caller must hold the lock.
-- p_nodes = jsonb array of { id, start_datetime, end_datetime, position }.
-- Update-only for now (no add/remove of cities yet) — only rows of this trip are touched.
-- Events/bookings are NOT changed here, so budget stays in sync (no event ids change).
create or replace function public.save_trip_structure(p_trip uuid, p_nodes jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_by uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  select editing_by into v_by from trips where id = p_trip for update;
  if v_by is distinct from v_uid then raise exception 'lock not held'; end if;

  update city_visits cv set
    start_datetime = nullif(n->>'start_datetime', '')::timestamptz,
    end_datetime   = nullif(n->>'end_datetime', '')::timestamptz,
    position       = nullif(n->>'position', '')::int
  from jsonb_array_elements(p_nodes) as n
  where cv.id = (n->>'id')::uuid and cv.trip_id = p_trip;

  update trips set editing_by = null, editing_since = null where id = p_trip;
end; $$;

grant execute on function public.acquire_trip_lock(uuid) to authenticated;
grant execute on function public.heartbeat_trip_lock(uuid) to authenticated;
grant execute on function public.release_trip_lock(uuid) to authenticated;
grant execute on function public.save_trip_structure(uuid, jsonb) to authenticated;
