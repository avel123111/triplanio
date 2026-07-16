-- TRIP-219 — contract: drop the "daily digest" reminder RPCs.
--
-- These 7 `get_trips_*_tomorrow()` functions were the data layer for the
-- getDailyReminders edge function ("tomorrow" digest reminders). That endpoint
-- is not wired to any active n8n workflow — the only live reminders workflow
-- ("TG Reminders", every 15 min) calls getPendingReminders exclusively. The
-- edge function + its config.toml pin are removed in the same PR, so these RPCs
-- have no remaining caller (verified: no reference in src/, other functions, or
-- CI manifests). Expand -> switch -> contract: this is the contract phase.
--
-- ddl-guard: allow-destructive — TRIP-219, contract, get_trips_*_tomorrow unused
-- (getDailyReminders removed in this PR; no other caller).

DROP FUNCTION IF EXISTS public.get_trips_hotel_checkin_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_hotel_checkout_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_hotel_cancel_deadline_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_transfer_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_activity_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_car_pickup_tomorrow();
DROP FUNCTION IF EXISTS public.get_trips_car_dropoff_tomorrow();
