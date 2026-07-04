-- TRIP-54 (companion): least-privilege on SECURITY DEFINER functions —
-- revoke the default anon/authenticated EXECUTE where no legitimate client uses it.
--
-- Root cause: Postgres/Supabase grants EXECUTE to anon+authenticated+service_role on
-- every function by default. SECURITY DEFINER runs with owner privileges and bypasses
-- RLS, so an unauthenticated caller (anon key → PostgREST RPC) could trigger privileged
-- behaviour. This closes the anon (and, where applicable, authenticated) attack path.
-- The EXECUTE-grant leg complements TRIP-54's search_path leg on the same functions.
--
-- Caller analysis (grep of src/ + supabase/functions/, live role check on prod):
--   * service_role has its own EXECUTE on every target (verified) → revoking anon/
--     authenticated never touches the edge-function path.
--   * Frontend calls run as `authenticated`; those functions keep authenticated.
--   * Trigger functions are fired by triggers (EXECUTE grant not consulted) → both revoked.
--
-- DELIBERATELY NOT TOUCHED (load-bearing / intentional):
--   * is_trip_participant / is_trip_creator — embedded in TO-public RLS policies on 12+
--     core tables; both anon AND authenticated need EXECUTE or every query to those
--     tables would fail with "permission denied for function". They return false for
--     anon (auth.uid() is null), so they are safe as-is.
--   * search_gazetteer — intentional public read-only city search.
--
-- Pure grant change: no data, no locks, no downtime. Rollback = re-GRANT.

-- ── Tier 1: service_role-only / internal / trigger → revoke anon AND authenticated ──
-- Real callers use the service_role edge client, or run as owner inside triggers/definers.
revoke execute on function public.rate_limit_check(p_bucket text, p_key text, p_max integer, p_window_seconds integer) from anon, authenticated;
revoke execute on function public.rate_limit_record(p_bucket text, p_key text)                                       from anon, authenticated;
revoke execute on function public.take_geocode_token(p_min numeric, p_rate numeric, p_cap numeric)                   from anon, authenticated;
-- ensure_trip_budget: only ever called internally (seed_budget_on_trip trigger + other
-- definers, all running as postgres). No external RPC caller. Was the anon-write vector.
revoke execute on function public.ensure_trip_budget(p_trip_id uuid)                                                 from anon, authenticated;
-- Trigger functions (return trigger) — never invoked via RPC.
revoke execute on function public.enforce_trip_limit()                                                               from anon, authenticated;
revoke execute on function public.notify_booking_added()                                                            from anon, authenticated;
revoke execute on function public.seed_budget_on_trip()                                                             from anon, authenticated;
revoke execute on function public.sync_budget_expense()                                                            from anon, authenticated;
revoke execute on function public.trg_recompute_transfer()                                                         from anon, authenticated;

-- ── Tier 2: authenticated-only (frontend / self-gated) → revoke anon, keep authenticated ──
revoke execute on function public.create_trip(p_title text, p_description text)                                      from anon;  -- ManualPlanner (authenticated); also raises 'Not authenticated'
revoke execute on function public.get_trip_participant_profiles(trip_id_list uuid[])                                 from anon;  -- Trips.jsx (authenticated); self-gates on auth.uid()
revoke execute on function public.get_user_travel_stats()                                                           from anon;  -- Statistics/Trips (authenticated); self-gates
revoke execute on function public._can_edit_trip(p_trip uuid, p_uid uuid)                                            from anon;  -- not in any policy; takes explicit p_uid
revoke execute on function public.get_trip_owner_profiles(trip_id_list uuid[])                                       from anon;  -- no external caller; self-gates
revoke execute on function public.link_pending_invites()                                                           from anon;  -- no external caller; self-gates
