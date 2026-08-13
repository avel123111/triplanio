-- TRIP-406 (доработка ревью): вердикт лимита трипов — ОДИН предикат.
--
-- ЗАЧЕМ. Правило «можно ли создать трип» (is_pro OR active<1) было выражено
-- ДВАЖДЫ: в триггере enforce_trip_limit (порог >=1) и в TS-требовании trip_quota
-- (mutate.ts: инлайн is_user_pro + count + литерал <1). Сводим к одному булеву
-- предикату `can_create_trip` — ровно как pro-гейт шва зовёт `is_trip_pro`. Триггер
-- (backstop) и шов (авторитетный гейт) теперь только ЗОВУТ его; порог и комбинация
-- живут в ОДНОМ месте. Клиентский src/lib/limits.js НЕ трогаем — это UX-пред-
-- проверка и единственная осознанно оставленная кросс-язычная копия литерала.
--
-- can_create_trip зеркалит ДОСТУП is_trip_pro/is_user_pro: SECURITY DEFINER, sql
-- STABLE, service_role-only (клиент её не зовёт — вызывает шов под service_role),
-- search_path пин public,pg_temp (TRIP-54). Гранты по идиоме TRIP-49 (REVOKE у
-- public/anon/authenticated + GRANT service_role).
--
-- enforce_trip_limit → CREATE OR REPLACE (сигнатура та же, триггер trips_enforce_limit
-- остаётся привязан), тело тождественно по Де Моргану:
--   not can_create_trip(uid)  ==  not is_user_pro(uid) AND count_active_owned_trips(uid) >= 1.
-- Порог >=1 больше в триггере не пишем. Деплой через CI/CD (job migrate).

create or replace function public.can_create_trip(p_uid uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select public.is_user_pro(p_uid) or public.count_active_owned_trips(p_uid) < 1
$function$;

revoke execute on function public.can_create_trip(uuid) from public, anon, authenticated;
grant  execute on function public.can_create_trip(uuid) to service_role;

create or replace function public.enforce_trip_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.created_by is not null and not public.can_create_trip(new.created_by) then
    raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
