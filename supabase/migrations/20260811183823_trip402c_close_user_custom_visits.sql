-- TRIP-402 шаг C — закрытие домена «статистика/визиты»: user_custom_visits edge-only.
--
-- Запись ручных визитов переключена на единый шов `_shared/mutate.ts` (service_role)
-- через ресурс `user-place` (PR #790, A+B): владение — актором из JWT
-- (scope.column=user_id), IDOR закрыт `buildPlan`. Чтение статов — RPC
-- `get_user_travel_stats(p_actor)` под service_role (EXECUTE у authenticated уже
-- снят в A+B, замер live dev: rpc_auth_exec=false). Клиент таблицу НАПРЯМУЮ ни
-- пишет, ни читает (во фронте ноль `.from('user_custom_visits')`, custom-точки
-- приходят только из RPC). До этого шага серверный гейт был ДЕКОРАТИВЕН: гранты
-- authenticated (arwdDxtm) и остаточный SELECT у anon были живы — клиент мог
-- писать/читать прямым REST в обход шва. Здесь дыра закрывается.
--
-- ПОЛНЫЙ close в ОДИН заход (не два, как у `users`): у users INSERT+SELECT
-- оставались под домен регистрации, здесь оставлять нечего — таблица целиком
-- edge-only, поэтому DML И SELECT снимаются разом.
--
-- ★ ПОРЯДОК ОБЯЗАТЕЛЕН: REVOKE грантов ИДЁТ ПЕРЕД дропом политик. Обратный
-- порядок открыл бы окно, где строку не держит ни политика, ни отсутствие гранта.
-- RLS остаётся ВКЛЮЧЁННОЙ — без политик это deny-all для клиентских ролей, а
-- service_role RLS обходит (шов записи + RPC чтения). Манифест `security-tiers`
-- переведён на ярус B → LIVE-assert (2e) сверит `has_*_privilege`, не текст.
--
-- ★ anon SELECT снимается ОБЯЗАТЕЛЬНО (замер live: anon=rDxtm — SELECT висит):
-- при `authSelect:false` LIVE-2e краснеет на «edge-only таблица отдаёт SELECT
-- anon». anon INSERT/UPDATE/DELETE уже нет (Ф3). service_role сохраняет свои
-- ЯВНЫЕ гранты — revoke адресован только клиентским ролям (замер relacl:
-- authenticated=arwdDxtm, anon=rDxtm, service_role=arwdDxtm).
--
-- destructive-guard (2c) НЕ трогаем маркером: его паттерны — DROP COLUMN/TABLE/
-- NOT NULL/RENAME/ALTER…DROP; REVOKE и DROP POLICY он не ловит (как и в
-- TRIP-399 шаг C — там маркера тоже нет). Деплой через CI/CD (job migrate).

-- 1) Клиентские гранты (сначала). Полный close: DML + SELECT у authenticated.
revoke insert, update, delete, select on public.user_custom_visits from authenticated;
-- anon уже без DML (relacl anon=rDxtm); снимаем остаточный SELECT — edge-only.
revoke select on public.user_custom_visits from anon;

-- 2) RLS-политики — ПОСЛЕ revoke. Все 4 (user_id = auth.uid()) больше не нужны:
--    клиент таблицы не касается, авторизацию держит шов + RPC под service_role.
drop policy if exists ucv_insert on public.user_custom_visits;
drop policy if exists ucv_update on public.user_custom_visits;
drop policy if exists ucv_delete on public.user_custom_visits;
drop policy if exists ucv_select on public.user_custom_visits;
