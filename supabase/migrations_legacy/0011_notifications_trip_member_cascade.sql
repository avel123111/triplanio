-- 0011_notifications_trip_member_cascade
--
-- Align notifications.trip_member_id → trip_members(id) to ON DELETE CASCADE.
--
-- Why: prod had this FK as ON DELETE NO ACTION while dev was already CASCADE
-- (schema drift). Every invited member has an invite notification referencing
-- their trip_members row, so on prod deleting/removing a member (and "leave
-- trip") failed with a FK violation. removeTripMember swallowed the error and
-- returned ok:true while the row survived. The edge function now also clears
-- referencing notifications before deleting, but this migration removes the
-- drift so both environments behave identically.
--
-- Idempotent: DROP IF EXISTS + ADD always re-creates the constraint with CASCADE,
-- so it is safe to run repeatedly and on both dev and prod.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_trip_member_id_fkey;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_trip_member_id_fkey
  FOREIGN KEY (trip_member_id)
  REFERENCES public.trip_members(id)
  ON DELETE CASCADE;
