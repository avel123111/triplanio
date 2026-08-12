-- TRIP-405 шаг C — закрытие домена броней: 4 booking-таблицы edge-only.
--
-- Запись броней переключена на единый шов `_shared/mutate.ts` (service_role)
-- через ресурс `trip-booking` (A+B этого PR): роль-гейт `editor` в TS
-- (зеркало `_can_edit_trip`), IDOR закрыт `buildPlan` скоупом `{id, trip_id}`;
-- сложный переезд — `op:'rpc'` (`add_layover_transfer(p_actor)`, EXECUTE у
-- authenticated уже снят в A+B). Чтение — `getTripDetails` под service_role; во
-- фронте ноль `.from('hotel_stays'|'transfers'|'activities'|'trip_services')` и
-- ноль прямых SELECT (view-панель = селектор кэша getTripDetails). До этого шага
-- серверный гейт был ДЕКОРАТИВЕН: гранты authenticated (arwdDxtm) и остаточный
-- SELECT у anon были живы — клиент мог писать/читать прямым REST в обход шва.
-- Здесь дыра закрывается.
--
-- ПОЛНЫЙ close в ОДИН заход: таблицы целиком edge-only (оставлять клиенту нечего),
-- поэтому DML И SELECT снимаются разом у authenticated.
--
-- ★ ПОРЯДОК ОБЯЗАТЕЛЕН: REVOKE грантов ИДЁТ ПЕРЕД дропом политик. Обратный
-- порядок открыл бы окно, где строку не держит ни политика, ни отсутствие гранта.
-- RLS остаётся ВКЛЮЧЁННОЙ — без политик это deny-all для клиентских ролей, а
-- service_role RLS обходит (шов записи + getTripDetails чтения). Манифест
-- `security-tiers` переведён на ярус B → LIVE-assert (2e) сверит `has_*_privilege`.
--
-- ★ anon SELECT снимается ОБЯЗАТЕЛЬНО (замер live dev: anon=rDxtm — SELECT висит):
-- при `authSelect:false` LIVE-2e краснеет на «edge-only таблица отдаёт SELECT
-- anon». anon INSERT/UPDATE/DELETE уже нет. service_role сохраняет ЯВНЫЕ гранты
-- (замер relacl: authenticated=arwdDxtm, anon=rDxtm, service_role=arwdDxtm) —
-- revoke адресован только клиентским ролям.
--
-- НЕ трогаем (все SECURITY DEFINER → срабатывают под service_role-записью edge,
-- close их не ломает): триггеры `trg_notify_booking_added` (живёт до TRIP-356 —
-- решение Pavel), `sync_budget_expense` (+ триггеры), `trg_recompute_transfer`,
-- и функцию `_can_edit_trip` (её держит Storage `_can_write_trip_file`).
--
-- destructive-guard (2c) НЕ трогаем маркером: его паттерны — DROP COLUMN/TABLE/
-- NOT NULL/RENAME/ALTER…DROP; REVOKE и DROP POLICY он не ловит (как TRIP-402c/399c).
-- Деплой через CI/CD (job migrate).

-- 1) Клиентские гранты (СНАЧАЛА). Полный close: DML + SELECT у authenticated.
revoke insert, update, delete, select on public.hotel_stays    from authenticated;
revoke insert, update, delete, select on public.transfers      from authenticated;
revoke insert, update, delete, select on public.activities     from authenticated;
revoke insert, update, delete, select on public.trip_services  from authenticated;

-- anon уже без DML (relacl anon=rDxtm); снимаем остаточный SELECT — edge-only.
revoke select on public.hotel_stays    from anon;
revoke select on public.transfers      from anon;
revoke select on public.activities     from anon;
revoke select on public.trip_services  from anon;

-- 2) RLS-политики — ПОСЛЕ revoke. Все 16 (per-command, TRIP-124: select=
--    is_trip_participant, insert/update/delete=_can_edit_trip) больше не нужны:
--    клиент таблиц не касается, авторизацию держит шов под service_role.
drop policy if exists hotel_stays_select    on public.hotel_stays;
drop policy if exists hotel_stays_insert    on public.hotel_stays;
drop policy if exists hotel_stays_update    on public.hotel_stays;
drop policy if exists hotel_stays_delete    on public.hotel_stays;

drop policy if exists transfers_select      on public.transfers;
drop policy if exists transfers_insert      on public.transfers;
drop policy if exists transfers_update      on public.transfers;
drop policy if exists transfers_delete      on public.transfers;

drop policy if exists activities_select     on public.activities;
drop policy if exists activities_insert     on public.activities;
drop policy if exists activities_update     on public.activities;
drop policy if exists activities_delete     on public.activities;

drop policy if exists trip_services_select  on public.trip_services;
drop policy if exists trip_services_insert  on public.trip_services;
drop policy if exists trip_services_update  on public.trip_services;
drop policy if exists trip_services_delete  on public.trip_services;
