-- Allow kind='waypoint' on city_visits (TRIP_EDIT_MODE_TZ §11): a single-date
-- transit node (layover / route point). Same shape as other nodes; the editor
-- stores start_datetime = end_datetime for a waypoint (no nights).
alter table public.city_visits drop constraint if exists city_visits_kind_check;
alter table public.city_visits
  add constraint city_visits_kind_check
  check (kind = any (array['transit'::text, 'start'::text, 'end'::text, 'waypoint'::text]));
