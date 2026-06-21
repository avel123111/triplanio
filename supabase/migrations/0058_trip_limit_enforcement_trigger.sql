-- 0058 — single-source trip-limit enforcement at the table level.
--
-- The free-tier rule ("at most 1 ACTIVE owned trip for non-Pro") used to live in
-- TWO places: the create_trip RPC (SQL) and the copyTrip edge function (TS),
-- both leaning on the shared count_active_owned_trips() helper. That left a third,
-- ungated path — a raw PostgREST insert into trips — which only failed by accident
-- (the non-SECURITY-DEFINER trips_create_group_chat trigger inserts into chats,
-- whose RLS has no INSERT policy, rolling back the whole statement).
--
-- This migration moves the rule into ONE BEFORE INSERT trigger on trips, so every
-- creation path (and any future one) is gated in a single place, and closes the
-- raw-insert path entirely. The active-trip COUNT stays in active_owned_trips()
-- (migration 0045) — unchanged — so the screen-level planner guard
-- (useActiveTripsLimit → getActiveTrips → active_owned_trips) and this hard
-- enforcement read the same number and can never drift.

-- 1) Enforcement function + trigger -------------------------------------------
create or replace function public.enforce_trip_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := NEW.created_by;
begin
  -- Gate human-owned creations against the free cap. Use NEW.created_by (NOT
  -- auth.uid()) so the rule holds for every entry path: create_trip (definer),
  -- copyTrip (service_role — auth.uid() is null), and any direct insert.
  if v_uid is not null and not public.is_user_pro(v_uid) then
    if public.count_active_owned_trips(v_uid) >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trips_enforce_limit on public.trips;
create trigger trips_enforce_limit
  before insert on public.trips
  for each row execute function public.enforce_trip_limit();

-- 2) Strip the now-duplicated limit check from create_trip --------------------
-- Limit is enforced by trips_enforce_limit; the RPC just authenticates + inserts.
create or replace function public.create_trip(p_title text, p_description text default ''::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid; v_trip_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Free-tier trip limit is enforced by the trips_enforce_limit BEFORE INSERT
  -- trigger (migration 0058) — single source for every creation path.
  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $$;

-- 3) Close the raw PostgREST creation path ------------------------------------
-- The frontend creates trips ONLY via create_trip (SECURITY DEFINER) and copyTrip
-- (service_role) — both bypass these role grants. Removing the authenticated/anon
-- INSERT grant eliminates the direct-insert path (and the half-baked-trip risk
-- where a raw insert passed RLS but rolled back on the chats trigger). The
-- trips_insert RLS policy becomes dead once INSERT is ungranted, so drop it.
revoke insert on public.trips from authenticated, anon;
drop policy if exists trips_insert on public.trips;
