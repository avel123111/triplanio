-- Free plan: at most 1 active trip, enforced server-side (backstop to the UI).
-- FIX: align the limit's "active" definition with the rest of the app.
--
-- Before: create_trip counted trips by the trips.end_date column. That column is
-- never populated (all trips have start_date/end_date NULL — dates live in
-- city_visits), so `(end_date is null or end_date >= current_date)` was ALWAYS
-- true and every owned trip counted as active forever. Result: any free user with
-- >=1 trip (active OR past) got TRIP_LIMIT_REACHED on the final create step, even
-- though the UI (getActiveTrips / isTripInPast) correctly showed 0 active.
--
-- After: "active" mirrors getActiveTrips and src/lib/trip-dates.js isTripInPast —
-- a trip is active when it has no dated visits yet, OR its latest
-- city_visits.end_date is today/future. One single definition across DB + edge + FE.
--
-- Pro users (active subscription) remain unlimited. Both create paths (manual + AI)
-- call this RPC. Deploy manually to prod (tizscxrpuopobgcxbekf) and dev
-- (nydhzevdizkfaxdlikgc).
create or replace function public.create_trip(p_title text, p_description text default '')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_trip_id uuid; v_is_pro boolean; v_active int;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Pro = active subscription (mirrors getUserPlan). Pro users have no trip limit.
  select (u.subscription_status = 'pro'
          and u.subscription_end_date is not null
          and u.subscription_end_date > now())
    into v_is_pro
  from public.users u where u.id = v_uid;
  v_is_pro := coalesce(v_is_pro, false);

  if not v_is_pro then
    -- "Active" by city_visits (same rule as getActiveTrips / isTripInPast):
    -- a trip with no dated visits → active; otherwise active iff its latest
    -- end_date is today/future. max() ignores NULL end_dates; coalesce handles
    -- trips with no dated visits (NULL → treated as active).
    select count(*) into v_active
    from public.trips t
    where t.created_by = v_uid
      and coalesce(
            (select max(cv.end_date) from public.city_visits cv where cv.trip_id = t.id),
            current_date
          ) >= current_date;
    if v_active >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $$;
