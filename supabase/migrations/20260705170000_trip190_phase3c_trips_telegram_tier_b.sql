-- TRIP-190 Ф3c — trips и trip_telegram_integrations в Ярус B (запись только edge).
--
-- Оба пишутся ТОЛЬКО через edge (service_role); клиент — нет:
--   trips: единственный прямой клиентский write (обложка в ManualPlanner) переведён
--          на edge updateTripSettings в ЭТОМ ЖЕ PR. Создание=create_trip(RPC),
--          удаление=deleteTrip, настройки=updateTripSettings — все service_role.
--          INSERT у authenticated уже отозван (TRIP-58).
--   trip_telegram_integrations: 0 обращений клиента из src/, всё через telegram* edge;
--          anon-DML снят в Ф3a/b.
--
-- Убираем поколоночные/ролевые исключения (хрупкий анти-паттерн, TRIP-62):
-- authenticated без DML, моот-политики записи дропаем (после ревока они мертвы и
-- вводят в заблуждение). SELECT остаётся — клиент читает. service_role (BYPASSRLS)
-- и edge не затронуты. Закрывает REST-обход read-only экранов для viewer (I5).

-- ── trips → Ярус B (SELECT остаётся) ─────────────────────────────────────────
revoke update, delete on public.trips from authenticated;
drop policy if exists "trips_update" on public.trips;
drop policy if exists "trips_delete" on public.trips;

-- ── trip_telegram_integrations → Ярус B (SELECT остаётся) ─────────────────────
revoke insert, update, delete on public.trip_telegram_integrations from authenticated;
drop policy if exists "trip_telegram_integrations_write" on public.trip_telegram_integrations;
