-- TRIP-284 (Block 2 PR B): снос немого триггера booking-уведомления.
--
-- Уведомление «добавлена бронь» переносится на edge-шов emit()/notify()
-- (событие `booking_added` в AFTER_WRITE шва mutate, mutateEffects.ts) — как
-- invite/member-события. Триггер `notify_booking_added` был:
--   • нем к сбою (`raise warning`, невидим Sentry);
--   • на 3 таблицах (hotel_stays/transfers/trip_services) — активности НЕ
--     уведомлял вовсе (теперь их эмитит шов);
--   • варил имя автора и сырой англ. kind в строку.
--
-- Атомарный cutover: emit уже пишет notifications в том же PR, поэтому дроп
-- триггера в этой же миграции убирает double-write (иначе дубли в инбоксе).
-- Тип `trip_booking_added` и i18n-ключи НЕ трогаем — edge продолжает их эмитить.

drop trigger if exists trg_notify_booking_added on public.hotel_stays;
drop trigger if exists trg_notify_booking_added on public.transfers;
drop trigger if exists trg_notify_booking_added on public.trip_services;

drop function if exists public.notify_booking_added();
