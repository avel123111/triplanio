-- TRIP-418 — единый словарь имён событий уведомлений (подзадача TRIP-356).
--
-- После унификации `emit('<event>')` = `notifications.type` = путь вебхука =
-- ключ текста. Пять имён переименованы в edge на канон CHECK (уже разрешённые
-- `trip_*`-значения), так что схема их принимала и раньше. ЕДИНСТВЕННОЕ событие
-- без легаси-эквивалента в CHECK — `pro_payment_failed` (линия «фейл платежа»
-- падала на `notifications_type_check`). Добавляем значение; существующие строки
-- не затрагиваются (расширение допустимого множества, не сужение).
-- ddl-guard: allow-destructive — CHECK нельзя изменить на месте: drop+immediate re-add
--   расширяет множество (добавлен pro_payment_failed), существующие строки не затрагиваются.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'trip_invite', 'trip_update', 'trip_member_joined', 'system', 'pro_activated',
    'trip_invite_declined', 'trip_member_left', 'trip_member_removed',
    'trip_role_changed', 'trip_booking_added',
    'pro_payment_failed'
  ]));
