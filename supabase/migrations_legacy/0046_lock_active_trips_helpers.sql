-- 0046_lock_active_trips_helpers.sql
-- Security hardening for the helpers added in 0045.
--
-- 0045 only did `revoke ... from public`, which does NOT remove EXECUTE that
-- Supabase grants directly to the `anon` and `authenticated` roles via default
-- privileges. Because active_owned_trips(uuid) / count_active_owned_trips(uuid)
-- are SECURITY DEFINER and take an arbitrary uid, that left them callable by any
-- signed-in (or even anonymous) user with someone else's uid — an IDOR that
-- leaks other users' active-trip titles and counts.
--
-- Lock them to service_role only. Edge functions call them with the service-role
-- key; create_trip (SECURITY DEFINER) calls them as its owner, so both keep working.

revoke execute on function public.active_owned_trips(uuid) from anon, authenticated;
revoke execute on function public.count_active_owned_trips(uuid) from anon, authenticated;
grant execute on function public.active_owned_trips(uuid) to service_role;
grant execute on function public.count_active_owned_trips(uuid) to service_role;
