-- TRIP-406 шаг C — закрытие двух-дверной `city_visits`: таблица edge-only.
--
-- Оба клиентских писателя убраны в A+B этого PR: 5 live-edit RPC ушли на edge
-- trip-route (op:'rpc', p_actor, EXECUTE у authenticated снят в A+B), прямой
-- client-insert при создании — на edge trip (create_trip_with_route,
-- service_role-only). Роль-гейт editor держит шов под service_role; IDOR закрыт
-- integrity-scope trip_id в телах RPC. Чтение — getTripDetails под service_role
-- (SHELL несёт cityVisits); во фронте ноль `.from('city_visits')`. До этого шага
-- серверный гейт был ДЕКОРАТИВЕН: гранты authenticated (arwdDxtm) и остаточный
-- SELECT у anon (rDxtm) были живы — клиент мог писать/читать прямым REST в обход
-- шва. Здесь дыра закрывается.
--
-- ПОЛНЫЙ close в ОДИН заход: таблица целиком edge-only (клиенту не остаётся
-- ничего), поэтому DML И SELECT снимаются разом у authenticated (+ anon SELECT).
--
-- ★ ПОРЯДОК ОБЯЗАТЕЛЕН: REVOKE грантов ИДЁТ ПЕРЕД дропом политик — обратный
-- порядок открыл бы окно, где строку не держит ни политика, ни отсутствие гранта.
-- RLS остаётся ВКЛЮЧЁННОЙ — без политик это deny-all для клиентских ролей, а
-- service_role RLS обходит (шов записи + getTripDetails чтения). Манифест
-- security-tiers переведён на ярус B → LIVE-2e сверит `has_*_privilege`.
-- service_role сохраняет ЯВНЫЕ гранты (relacl service_role=arwdDxtm) — revoke
-- адресован только клиентским ролям (замер live dev 2026-08-12: authenticated=
-- arwdDxtm, anon=rDxtm, service_role=arwdDxtm).
--
-- НЕ трогаем (SECURITY DEFINER → срабатывают под service_role-записью edge): движок
-- дат `recompute_trip`/`_trip_anchor_date`, триггеры budget/recompute, функцию
-- `_can_edit_trip` (её держит Storage `_can_write_trip_file`).
--
-- Плюс DROP мёртвой `create_trip(text,text)`: клиентский вызыватель был только
-- ManualPlanner (уходит на create_trip_with_route в этом PR); серверных нет
-- (getActiveTrips/copyTrip лишь упоминают её в комментариях, copyTrip создаёт трип
-- своим путём). Смена сигнатуры create → новая функция, старую убираем.
--
-- destructive-guard (2c) НЕ трогаем маркером: его паттерны — DROP COLUMN/TABLE/
-- NOT NULL/RENAME/ALTER…DROP; REVOKE, DROP POLICY и DROP FUNCTION он не ловит
-- (как TRIP-405c/402c/399c). Деплой через CI/CD (job migrate).

-- 1) Клиентские гранты (СНАЧАЛА). Полный close: DML + SELECT у authenticated.
revoke insert, update, delete, select on public.city_visits from authenticated;

-- anon уже без DML (relacl anon=rDxtm); снимаем остаточный SELECT — edge-only.
revoke select on public.city_visits from anon;

-- 2) RLS-политики — ПОСЛЕ revoke. Все 4 (per-command, TRIP-124: select=
--    is_trip_participant, insert/update/delete=_can_edit_trip) больше не нужны:
--    клиент таблицы не касается, авторизацию держит шов под service_role.
drop policy if exists city_visits_select on public.city_visits;
drop policy if exists city_visits_insert on public.city_visits;
drop policy if exists city_visits_update on public.city_visits;
drop policy if exists city_visits_delete on public.city_visits;

-- 3) Мёртвая create_trip (заменена create_trip_with_route в A+B).
drop function if exists public.create_trip(text, text);
