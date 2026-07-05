-- TRIP-49: least-privilege EXECUTE on SECURITY DEFINER RPC — real fix.
--
-- Supersedes 20260704224000_secdef_revoke_anon_execute.sql, which was INEFFECTIVE:
-- it ran `REVOKE ... FROM anon, authenticated`, but on these functions EXECUTE is
-- held by the Postgres-default PUBLIC grant (ACL `=X/postgres`). Revoking from a
-- specific role does NOT remove the PUBLIC grant, so `anon` kept EXECUTE via PUBLIC
-- (verified on dev: 13 of 15 targets still returned has_function_privilege('anon',
-- …, 'EXECUTE') = true after that migration). The correct target is PUBLIC.
--
-- Why revoking PUBLIC is safe (no user/edge/n8n impact — all verified):
--   * service_role has its OWN explicit EXECUTE (`service_role=X`) on every target →
--     REVOKE FROM PUBLIC leaves it intact → edge functions (service_role) unaffected.
--   * Frontend calls run as `authenticated`; for the functions it actually calls we
--     re-GRANT to authenticated explicitly below (idempotent — guarantees identical
--     end-state on dev, where 20260704224000 stripped some explicit authenticated
--     grants, and on prod, where that migration never ran).
--   * Trigger functions (return trigger) are fired by triggers, never via RPC — the
--     EXECUTE grant is not consulted; revoking is pure defense-in-depth.
--   * n8n reaches Supabase via edge (Bearer/N8N_SECRET), PostgREST under a service-role
--     credential, or a direct Postgres connection — none of these 13 functions are
--     called by any n8n workflow (the only RPC n8n calls, get_ai_usage_cursor, is NOT
--     in scope and is deliberately left untouched).
--
-- DELIBERATELY NOT TOUCHED (load-bearing / intentional public access):
--   * is_trip_participant / is_trip_creator — embedded in TO-public RLS policies on
--     12+ tables; both anon AND authenticated must keep EXECUTE or every query to
--     those tables fails "permission denied for function". Safe: return false for anon.
--   * search_gazetteer — intentional public read-only city search.
--
-- Scope is EXACTLY the 13 functions below, targeted by signature — never a blanket
-- revoke on all SECURITY DEFINER functions (that would break n8n's get_ai_usage_cursor
-- and other legitimately-public definers).
--
-- Pure grant change: no data, no locks, no downtime. Rollback = re-GRANT to public.

-- ── Tier 1: service_role-only / internal / trigger → EXECUTE only for postgres + service_role ──
-- Real callers: edge under service_role, or owner-context inside triggers/definers.
revoke execute on function public.ensure_trip_budget(p_trip_id uuid)                                                  from public, anon, authenticated;
revoke execute on function public.take_geocode_token(p_min numeric, p_rate numeric, p_cap numeric)                    from public, anon, authenticated;
revoke execute on function public.rate_limit_check(p_bucket text, p_key text, p_max integer, p_window_seconds integer) from public, anon, authenticated;
revoke execute on function public.rate_limit_record(p_bucket text, p_key text)                                        from public, anon, authenticated;
-- Trigger functions (return trigger) — never invoked via RPC.
revoke execute on function public.enforce_trip_limit()                                                                from public, anon, authenticated;
revoke execute on function public.notify_booking_added()                                                             from public, anon, authenticated;
revoke execute on function public.seed_budget_on_trip()                                                              from public, anon, authenticated;
revoke execute on function public.sync_budget_expense()                                                             from public, anon, authenticated;
revoke execute on function public.trg_recompute_transfer()                                                          from public, anon, authenticated;

-- ── Tier 2: authenticated frontend callers → drop PUBLIC + anon, guarantee authenticated ──
-- REVOKE strips the implicit public/anon path; GRANT makes the authenticated grant
-- explicit and idempotent regardless of each project's prior ACL state.
revoke execute on function public.create_trip(p_title text, p_description text)                                       from public, anon;
grant  execute on function public.create_trip(p_title text, p_description text)                                       to authenticated;

revoke execute on function public.get_trip_participant_profiles(trip_id_list uuid[])                                  from public, anon;
grant  execute on function public.get_trip_participant_profiles(trip_id_list uuid[])                                  to authenticated;

revoke execute on function public.get_trip_owner_profiles(trip_id_list uuid[])                                        from public, anon;
grant  execute on function public.get_trip_owner_profiles(trip_id_list uuid[])                                        to authenticated;

revoke execute on function public.get_user_travel_stats()                                                            from public, anon;
grant  execute on function public.get_user_travel_stats()                                                            to authenticated;

revoke execute on function public._can_edit_trip(p_trip uuid, p_uid uuid)                                             from public, anon;
grant  execute on function public._can_edit_trip(p_trip uuid, p_uid uuid)                                             to authenticated;

revoke execute on function public.link_pending_invites()                                                            from public, anon;
grant  execute on function public.link_pending_invites()                                                            to authenticated;
