-- 0020_notifications_trip_id_cascade
--
-- Align notifications.trip_id → trips(id) to ON DELETE CASCADE.
--
-- Why: deleting a trip failed with
--   "update or delete on table \"trips\" violates foreign key constraint
--    notifications_trip_id_fkey on table notifications"
-- because this FK was ON DELETE NO ACTION on prod (dev was already CASCADE —
-- the same prod↔dev drift that 0011 fixed for notifications.trip_member_id).
-- Any trip that ever produced a notification (invites, reminders, …) could not
-- be deleted. Notifications are disposable, so cascading them on trip delete is
-- correct. Trip deletion runs client-side under the owner's RLS, which cannot
-- reach other members' notification rows, so the cleanup must live in the FK.
--
-- NOTE (intentionally NOT changed here): partner_clicks.trip_id and
-- trip_subscriptions.trip_id are also ON DELETE NO ACTION on prod. They are
-- money/attribution records that must survive trip deletion, so they are
-- handled separately (SET NULL, pending decision) — NOT cascaded.
--
-- Idempotent: DROP IF EXISTS + ADD re-creates the constraint with CASCADE, so
-- it is safe to run repeatedly and on both dev and prod.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_trip_id_fkey;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_trip_id_fkey
  FOREIGN KEY (trip_id)
  REFERENCES public.trips(id)
  ON DELETE CASCADE;
