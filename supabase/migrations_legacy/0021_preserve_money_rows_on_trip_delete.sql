-- 0021_preserve_money_rows_on_trip_delete
--
-- partner_clicks.trip_id and trip_subscriptions.trip_id → ON DELETE SET NULL.
--
-- Why: both tables hold money/audit records that MUST survive trip deletion:
--   * partner_clicks  — affiliate attribution log (never deleted anywhere).
--   * trip_subscriptions — Stripe billing record. Webhooks only flip its
--     `status` ('cancelled'/'expired') on cancel/expiry/delete; the row itself
--     is never removed (only deleteMyAccount removes it, by user_id). So it
--     outlives both the subscription and the trip.
--
-- Neither may be CASCADE-deleted with the trip. But NO ACTION (prod) blocks the
-- whole trip deletion, and CASCADE (dev drift) silently destroys the billing /
-- attribution record. SET NULL is the only behaviour that keeps the record AND
-- lets the trip be deleted: it drops the (now-meaningless) trip pointer while
-- preserving stripe_subscription_id / user_id / amounts / status for billing
-- reconciliation. Both trip_id columns are nullable, so SET NULL is valid.
--
-- This also aligns prod (was NO ACTION) and dev (was CASCADE) to the same rule.
--
-- Idempotent: DROP IF EXISTS + ADD re-creates each constraint, safe to re-run
-- on both environments.

ALTER TABLE public.partner_clicks
  DROP CONSTRAINT IF EXISTS partner_clicks_trip_id_fkey;
ALTER TABLE public.partner_clicks
  ADD CONSTRAINT partner_clicks_trip_id_fkey
  FOREIGN KEY (trip_id)
  REFERENCES public.trips(id)
  ON DELETE SET NULL;

ALTER TABLE public.trip_subscriptions
  DROP CONSTRAINT IF EXISTS trip_subscriptions_trip_id_fkey;
ALTER TABLE public.trip_subscriptions
  ADD CONSTRAINT trip_subscriptions_trip_id_fkey
  FOREIGN KEY (trip_id)
  REFERENCES public.trips(id)
  ON DELETE SET NULL;
