-- 0057: defense-in-depth — recompute_user_entitlement is service-role-only.
--
-- recompute_user_entitlement(uuid) is SECURITY DEFINER and writes the entitlement
-- cache (users.subscription_status / subscription_end_date). Supabase grants
-- EXECUTE on new public functions to anon/authenticated by default
-- (ALTER DEFAULT PRIVILEGES), and `revoke ... from public` does NOT remove that —
-- an explicit revoke from those roles is required.
--
-- Not directly exploitable today (it only recomputes the cache from the ledger —
-- no ledger row, no Pro; an arbitrary uid just recomputes someone else's cache
-- idempotently). But per the project invariant "entitlement is written by the
-- server only", the client must not be able to invoke it at all. Same hardening
-- already applied to is_user_pro / is_trip_pro (0055).
--
-- create_trip is intentionally left executable by authenticated — it is the RPC
-- the client legitimately calls to create trips.
--
-- Idempotent. Apply to BOTH projects (prod tizscxrpuopobgcxbekf + dev nydhzevdizkfaxdlikgc).

revoke all on function public.recompute_user_entitlement(uuid) from public;
revoke execute on function public.recompute_user_entitlement(uuid) from anon, authenticated;
grant execute on function public.recompute_user_entitlement(uuid) to service_role;
