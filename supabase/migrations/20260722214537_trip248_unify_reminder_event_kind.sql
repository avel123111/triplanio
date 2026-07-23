-- TRIP-248: unify the telegram_reminder_logs.event_kind vocabulary.
--
-- The reminder event_kind was written by two generations of code with two
-- different names for car-rental reminders:
--   * legacy sendTripReminders (pre-n8n) wrote 'car_rental_start' / 'car_rental_end'
--   * the current get_pending_reminders writes 'car_rental_pickup' / 'car_rental_dropoff'
-- Both spellings survived: the CHECK constraint allowed all four and the live
-- producer only ever emits the pickup/dropoff pair. This migration folds the
-- legacy rows into the canonical pair and narrows the CHECK to the exact seven
-- kinds the system emits today, so the column speaks one vocabulary.
--
-- ddl-guard: allow-destructive — TRIP-248 vocabulary unification. The UPDATE/
-- DELETE only touch dead legacy 'car_rental_start'/'car_rental_end' rows (dedup
-- markers for past events written by a function retired before n8n); no live
-- reminder path emits them. delivered_at/output are untouched.
-- caps-guard: allow-uncapped — no new columns; only a CHECK is rewritten.

-- 1. Rename legacy rows to the canonical spelling, skipping any that would
--    collide with an already-canonical row for the same (user, event): those
--    are exact duplicates of a reminder the new sender already logged.
update public.telegram_reminder_logs t
   set event_kind = case t.event_kind
                      when 'car_rental_start' then 'car_rental_pickup'
                      when 'car_rental_end'   then 'car_rental_dropoff'
                    end
 where t.event_kind in ('car_rental_start', 'car_rental_end')
   and not exists (
     select 1
       from public.telegram_reminder_logs x
      where x.user_id  = t.user_id
        and x.event_id = t.event_id
        and x.event_kind = case t.event_kind
                             when 'car_rental_start' then 'car_rental_pickup'
                             when 'car_rental_end'   then 'car_rental_dropoff'
                           end
   );

-- 2. Whatever legacy rows remain are the collisions skipped above — pure
--    duplicates of a canonical row — so dropping them loses no information and
--    cannot cause a re-send (the canonical row still dedups the event).
delete from public.telegram_reminder_logs
 where event_kind in ('car_rental_start', 'car_rental_end');

-- 3. Narrow the allow-list to the seven kinds get_pending_reminders emits. This
--    CHECK is now the single authoritative list of reminder kinds.
alter table public.telegram_reminder_logs
  drop constraint if exists telegram_reminder_logs_event_kind_check;

alter table public.telegram_reminder_logs
  add constraint telegram_reminder_logs_event_kind_check
  check (event_kind = any (array[
    'hotel_checkin',
    'hotel_checkout',
    'hotel_cancel_deadline',
    'transfer_start',
    'activity_start',
    'car_rental_pickup',
    'car_rental_dropoff'
  ]));
