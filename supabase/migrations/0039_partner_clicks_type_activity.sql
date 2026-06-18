-- Allow `activity` in partner_clicks.type so Viator / GetYourGuide activity-fork
-- clicks can be logged. The old CHECK enumerated only hotel/transfer/esim/
-- carrental/insurance, so type='activity' inserts were rejected (SQLSTATE 23514)
-- and silently swallowed by the fire-and-forget logger (partnerTracking.js).

alter table public.partner_clicks drop constraint if exists partner_clicks_type_check;
alter table public.partner_clicks add constraint partner_clicks_type_check
  check (type = any (array['transfer'::text,'hotel'::text,'esim'::text,'carrental'::text,'insurance'::text,'activity'::text]));
