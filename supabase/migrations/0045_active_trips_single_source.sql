-- 0045_active_trips_single_source.sql
-- Single source of truth for the free-tier "active owned trip" rule.
--
-- Rule (canonical): a trip counts toward the free limit when
--   created_by = uid  AND  the trip is "active", where active means
--   it has no dated city_visits yet, OR max(city_visits.end_date) >= current_date.
--
-- This rule was previously duplicated — and drifted — across create_trip (SQL),
-- getActiveTrips (edge) and copyTrip (edge): different column (end_date vs the
-- non-existent end_datetime), different number (1 vs 3) and different filter
-- (active-only vs all trips). All three now funnel through these helpers so the
-- definition lives in exactly one place and ships with the DB.

create or replace function public.active_owned_trips(p_uid uuid)
returns table (id uuid, title text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.title
  from public.trips t
  where t.created_by = p_uid
    and coalesce(
          (select max(cv.end_date) from public.city_visits cv where cv.trip_id = t.id),
          current_date
        ) >= current_date
$$;

create or replace function public.count_active_owned_trips(p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.active_owned_trips(p_uid)
$$;

-- These take an arbitrary uid, so they must NOT be reachable by end users
-- (that would leak other users' active-trip titles / counts — an IDOR). Only the
-- service role (edge functions) and SECURITY DEFINER callers may execute them.
revoke all on function public.active_owned_trips(uuid) from public;
revoke all on function public.count_active_owned_trips(uuid) from public;
grant execute on function public.active_owned_trips(uuid) to service_role;
grant execute on function public.count_active_owned_trips(uuid) to service_role;

-- Repoint create_trip enforcement onto the single source (behaviour-preserving).
create or replace function public.create_trip(p_title text, p_description text default ''::text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid; v_trip_id uuid; v_is_pro boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select (u.subscription_status = 'pro'
          and u.subscription_end_date is not null
          and u.subscription_end_date > now())
    into v_is_pro
  from public.users u where u.id = v_uid;
  v_is_pro := coalesce(v_is_pro, false);

  if not v_is_pro then
    if public.count_active_owned_trips(v_uid) >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $function$;
