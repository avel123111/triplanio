-- TRIP-399 шаг C — закрытие домена «документы»: edge-only.
--
-- Карточка документа (`trip_documents`) переключена на единый шов записи
-- `_shared/mutate.ts` (service_role) через функцию `trip-document` (PR #770, A+B).
-- Клиент больше не пишет и не читает таблицу напрямую: запись — через шов
-- (право editor + построчное право удаления `guardRow` private⇒автор), чтение —
-- `getTripDetails` под service_role с фильтром `visibility=shared OR
-- created_by=self` (TRIP-118 не регрессирует). Во фронте ноль
-- `.from('trip_documents')` (проверено грепом src/). До этого шага серверный
-- гейт был ДЕКОРАТИВЕН: гранты `authenticated` на таблице были живы, и клиент
-- мог писать/читать прямым REST в обход шва. Здесь дыра закрывается.
--
-- ★ ПОРЯДОК ОБЯЗАТЕЛЕН: REVOKE грантов ИДЁТ ПЕРЕД снятием политик. Обратный
-- порядок открыл бы окно, где строку не держит ни политика, ни отсутствие
-- гранта. RLS остаётся ВКЛЮЧЁННОЙ — без политик это deny-all для клиентских
-- ролей, а service_role RLS обходит (шов записи, ридер, teardown личных доков).
-- Манифест `security-tiers` переведён на ярус B → LIVE-assert (2e) сверит, что
-- `authenticated` DML/SELECT реально снят (`has_table_privilege`, не текст).
--
-- ★ `_can_edit_trip` и бакет Storage `trips` НЕ ТРОГАЕМ: байты файлов остаются
-- прямой дверью (`_can_write_trip_file → _can_edit_trip`) — отдельная авторизация.
--
-- service_role сохраняет свои ЯВНЫЕ гранты (revoke адресован только клиентским
-- ролям) — замер relacl до правки: authenticated=arwdDxtm, anon=rDxtm,
-- service_role=arwdDxtm.

-- 1) Клиентские гранты (сначала).
revoke insert, update, delete, select on public.trip_documents from authenticated;
-- anon уже без DML (relacl anon=rDxtm); снимаем и остаточный SELECT — edge-only.
revoke select on public.trip_documents from anon;

-- 2) RLS-политики — ПОСЛЕ revoke. Все 4 (SELECT=_can_access_trip_document,
--    INSERT/UPDATE/DELETE=_can_edit_trip[+visibility]) больше не нужны: клиент
--    таблицы не касается, авторизацию записи держит шов в edge.
drop policy if exists trip_documents_insert on public.trip_documents;
drop policy if exists trip_documents_update on public.trip_documents;
drop policy if exists trip_documents_delete on public.trip_documents;
drop policy if exists trip_documents_select on public.trip_documents;
