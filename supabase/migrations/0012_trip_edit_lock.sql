-- Edit Mode concurrency lock on trips (TRIP_EDIT_MODE_TZ §3).
-- Neutral for current UI: nullable columns ignored by existing code.
alter table public.trips
  add column if not exists editing_by uuid references public.users(id) on delete set null,
  add column if not exists editing_since timestamptz;

comment on column public.trips.editing_by is
  'Edit Mode lock holder (users.id). NULL = not being edited. Paired with editing_since; TTL 30 min, heartbeat ~5 min.';
comment on column public.trips.editing_since is
  'When the current Edit Mode lock was taken/heartbeated. A lock older than the TTL may be reclaimed by another user.';
