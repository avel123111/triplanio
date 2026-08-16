-- TRIP-425 hotfix (эпик TRIP-374, волна 3) — прямая дверь чата сломалась после
-- снятия грантов у браузерных ролей.
--
-- Регресс: миграция 20260815200000 сняла у `authenticated` SELECT на `trips`
-- и `trip_members` (двери в БД). Политика `chats_select_for_trip_members`
-- осталась на СТАРОМ стиле — прямой подзапрос
--   `trip_id IN (SELECT trips.id FROM trips WHERE created_by = auth.uid()
--                UNION SELECT trip_members.trip_id FROM trip_members
--                WHERE user_id = auth.uid() AND status = 'active')`
-- который выполняется под ролью ВЫЗЫВАЮЩЕГО (`authenticated`). Без гранта на
-- `trips`/`trip_members` подзапрос падает `42501 permission denied for table
-- trips` при вычислении политики → SELECT на `chats` даёт 403 даже владельцу и
-- админу трипа (realtime-чат — намеренно разрешённая прямая дверь §1 хендоффа).
--
-- `chat_messages` той же беды не словил: он уже на SECDEF-предикате
-- `is_trip_participant(trip_id)`, который читает `trips`/`trip_members` под
-- привилегиями DEFINER, а не вызывающего. `chats` — единственная дверь чата,
-- оставшаяся на прямом подзапросе.
--
-- Фикс: перевести `chats` на ТОТ ЖЕ SECDEF-предикат `is_trip_participant`.
-- Семантика идентична (создатель ИЛИ активный участник — ровно то, что делал
-- подзапрос), гранты вызывающего на `trips` больше НЕ нужны, дверь `trips` НЕ
-- переоткрывается. Приводит `chats` к тому же канону, что `chat_messages`.

drop policy if exists chats_select_for_trip_members on public.chats;

create policy chats_select_for_trip_members on public.chats
  for select to public
  using (public.is_trip_participant(trip_id));
