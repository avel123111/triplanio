-- TRIP-394 Ф2, шаг C — закрытие домена «бюджет»: edge-only.
--
-- Бюджет переключён на единый шов записи `_shared/mutate.ts` (service_role,
-- PR #757). До этого шага серверный Pro-гейт бюджета был ДЕКОРАТИВЕН: гранты
-- `authenticated` на `budget_*`/`trip_budgets` были живы, и клиент мог писать
-- бюджет прямым REST в обход шва (дыра предсуществующая, #757 её не ухудшил).
-- Здесь она закрывается: клиент больше не пишет и не читает эти таблицы
-- напрямую (чтение — `getTripDetails` под service_role; во фронте ноль
-- `.from('budget_*')`, проверено грепом src/).
--
-- ★ ПОРЯДОК ОБЯЗАТЕЛЕН: REVOKE грантов ИДЁТ ПЕРЕД снятием политик. Обратный
-- порядок открыл бы окно, где строку не держит ни политика, ни отсутствие
-- гранта. RLS остаётся ВКЛЮЧЁННОЙ — без политик это deny-all для клиентских
-- ролей, а service_role RLS обходит (шов, триггеры авто-трат/сброса fx, ридер).
-- Манифест `security-tiers` переведён на ярус B → LIVE-assert (2e) сверит, что
-- `authenticated` DML реально снят (проверяется `has_table_privilege`, не текст).
--
-- service_role сохраняет свои ЯВНЫЕ гранты (revoke адресован только клиентским
-- ролям) — замер relacl до правки: service_role=arwdDxtm.

-- 1) Клиентские гранты (сначала).
revoke insert, update, delete, select on public.budget_expenses   from authenticated;
revoke insert, update, delete, select on public.budget_categories from authenticated;
revoke insert, update, delete, select on public.trip_budgets       from authenticated;
-- anon уже без DML (relacl anon=rDxtm); снимаем и остаточный SELECT — edge-only.
revoke select on public.budget_expenses   from anon;
revoke select on public.budget_categories from anon;
revoke select on public.trip_budgets       from anon;

-- 2) RLS-политики — ПОСЛЕ revoke. Все 12 (SELECT=is_trip_participant,
--    INSERT/UPDATE/DELETE=_can_edit_trip) больше не нужны: клиент таблиц не
--    касается, авторизацию записи держит шов в edge.
drop policy if exists budget_expenses_select   on public.budget_expenses;
drop policy if exists budget_expenses_insert   on public.budget_expenses;
drop policy if exists budget_expenses_update   on public.budget_expenses;
drop policy if exists budget_expenses_delete   on public.budget_expenses;
drop policy if exists budget_categories_select on public.budget_categories;
drop policy if exists budget_categories_insert on public.budget_categories;
drop policy if exists budget_categories_update on public.budget_categories;
drop policy if exists budget_categories_delete on public.budget_categories;
drop policy if exists trip_budgets_select      on public.trip_budgets;
drop policy if exists trip_budgets_insert      on public.trip_budgets;
drop policy if exists trip_budgets_update      on public.trip_budgets;
drop policy if exists trip_budgets_delete      on public.trip_budgets;
