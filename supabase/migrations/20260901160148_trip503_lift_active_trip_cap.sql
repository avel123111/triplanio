-- TRIP-503: временно снять лимит активных трипов на Free — ПОДНЯТИЕ ПОРОГА, не выпил логики.
--
-- ЗАЧЕМ. Правило «можно ли создать трип» живёт ОДНИМ предикатом can_create_trip
-- (TRIP-406): его зовут триггер enforce_trip_limit (backstop), шов mutate.ts
-- (trip_quota, авторитетный гейт), create_trip_with_route и copy_trip. Порог тут
-- один на всех — подняв его, гасим баннер, блокер планнера, TripLimitDialog и гейт
-- копирования ПО ПОСТРОЕНИЮ, ничего не удаляя. Возврат = вернуть цифру обратно.
--
-- Меняется РОВНО одна цифра порога (было 1). Тело в остальном тождественно
-- 20260812191742_trip406_trip_quota_single_predicate.sql: SECURITY DEFINER, sql
-- STABLE, search_path пин public,pg_temp, гранты service_role-only. create or replace
-- сохраняет гранты и search_path — их не переобъявляем. Триггер enforce_trip_limit
-- НЕ трогаем: он лишь зовёт этот предикат, своего порога не имеет.
--
-- ★ ЛОВУШКА ГАРДА ПРИ ВОЗВРАТЕ (src/lib/limits.test.js). Дрифт-гард сверяет ТЕКСТ:
-- берёт первое `count_active_owned_trips(...) < N` после `can_create_trip` и требует
-- N == FREE_ACTIVE_TRIP_LIMIT. Он не понимает семантику SQL. Поэтому в теле новой
-- миграции НЕ должно быть иного числового литерала этого вида раньше настоящего —
-- ни в комментарии, ни в De-Morgan-пояснении. Иначе на ОТКАТЕ (тело вернули на 1,
-- а в комментарии осталось «стало ... 1000») гард схватит не то число и даст ложный
-- зелёный при живом пороге. Здесь такого литерала в комментариях нет намеренно.

create or replace function public.can_create_trip(p_uid uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select public.is_user_pro(p_uid) or public.count_active_owned_trips(p_uid) < 1000
$function$;
