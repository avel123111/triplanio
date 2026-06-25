-- 0026_notifications_type_check_add_member_events
--
-- The notifications.type CHECK constraint only allowed
-- ('trip_invite','trip_update','trip_member_joined','system'). New member-event
-- notifications (M1–M4) were silently rejected by the constraint — and because
-- the edge functions insert them best-effort (try/catch), the failure was silent.
--
-- Expand the allow-list to cover:
--   trip_invite_declined  — M1, inviter is told the invite was declined
--   trip_member_left      — M2, owner/admins told a member left voluntarily
--   trip_member_removed   — M3, the removed member is told
--   trip_role_changed     — M4, the affected member is told their role changed
-- Also adds 'pro_activated' (documented in notifications-catalog.js / used by
-- the Stripe webhook) which was missing from the constraint.

alter table public.notifications drop constraint if exists notifications_type_check;

alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'trip_invite'::text,
    'trip_update'::text,
    'trip_member_joined'::text,
    'system'::text,
    'pro_activated'::text,
    'trip_invite_declined'::text,
    'trip_member_left'::text,
    'trip_member_removed'::text,
    'trip_role_changed'::text
  ]));
