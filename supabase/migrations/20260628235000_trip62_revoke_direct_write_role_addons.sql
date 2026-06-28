-- TRIP-62 — закрытие обхода прав через прямой REST (broken access control).
--
-- Единый паттерн (тот же, которым уже защищены trips.is_pro_trip и
-- users.subscription_*): у anon/authenticated НЕТ прямой записи в чувствительные
-- места; в эти таблицы пишут ТОЛЬКО сервисные edge-функции/RPC (service role,
-- гранты/RLS обходят). Без триггеров, без правок RLS-политик, без новых колонок.
--
-- Факт-база (repo @ dev, проверено grep'ом): фронт (src/) НЕ пишет напрямую ни в
-- trips, ни в trip_members — все мутации идут через функции:
--   trip_members → updateTripMemberRole / respondTripInvite / redeemTripInviteLink
--                  / inviteTripMember / removeTripMember / addOfflineTripMember
--   trips        → updateTripSettings / create_trip(RPC) / copyTrip / ensureShareToken
-- Поэтому отзыв прямых грантов ничего на фронте не ломает.

-- ---------------------------------------------------------------------------
-- S1 (Вектор B) — самоэскалация роли: участник PATCH'ил свою строку role='admin'.
-- trip_members имеет ТАБЛИЧНЫЙ UPDATE-грант (покрывает и колонку role), а RLS
-- trip_members_update разрешает запись своей строки (user_id = auth.uid()).
-- Прямых клиентских писателей у таблицы нет → отзываем прямой UPDATE целиком.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.trip_members FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- S2 (Вектор A — аддоны): владелец PATCH'ил trips.details.addons = {budget/chat/
-- telegram_assistant: true} в обход updateTripSettings (там гейт is_trip_pro),
-- включая платные аддоны бесплатно. trips имеет КОЛОНОЧНЫЙ UPDATE-грант, поэтому
-- точечно снимаем запись колонки details (is_pro_trip уже отозван ранее).
-- ---------------------------------------------------------------------------
REVOKE UPDATE (details) ON public.trips FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- S3 (гигиена): у anon остались дефолтные DML-гранты на эти таблицы. RLS их и так
-- обнуляет (auth.uid() = null), эксплойта нет, но лишних грантов быть не должно.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.trip_members FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.trips        FROM anon;
