-- Новый тип уведомления `trip_pro_activated` — «Pro куплен на конкретное
-- путешествие».
--
-- Разовая покупка trip_pro_lifetime списывает деньги и молча включает Pro-функции:
-- уведомления об этом не существовало вовсе (подписка своё имела, покупка трипа —
-- нет). Единый словарь имён (TRIP-418): имя события = notifications.type = хвост
-- ключей текста, поэтому значение добавляем ровно тем же именем, каким emit зовёт
-- событие.
--
-- ddl-guard: allow-destructive — CHECK нельзя изменить на месте: drop + немедленный
--   re-add РАСШИРЯЕТ множество (добавлен trip_pro_activated), существующие строки
--   не затрагиваются и остаются валидными.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'trip_invite', 'trip_update', 'trip_member_joined', 'system', 'pro_activated',
    'trip_invite_declined', 'trip_member_left', 'trip_member_removed',
    'trip_role_changed', 'trip_booking_added',
    'pro_payment_failed', 'trip_pro_activated'
  ]));
