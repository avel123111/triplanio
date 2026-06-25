-- 0055: единый серверный предикат Pro (T6).
--
-- Цель: ОДНО определение «активен ли Pro» вместо ~7 инлайн-копий, разбросанных по
-- create_trip (SQL), getActiveTrips/copyTrip/updateTripSettings/getUserPlan/
-- checkSubscriptionStatus (edge) и subscription.js (FE). Здесь — канонический SQL.
--
-- Семантика ЗЕРКАЛИТ create_trip (0045): null end_date = НЕ pro.
--   is_user_pro := status='pro' AND end_date IS NOT NULL AND end_date > now()
--   is_trip_pro := trips.is_pro_trip OR is_user_pro(trips.created_by)   (owner-based, см. модель Pro)
--
-- SECURITY DEFINER + явный search_path. Функции принимают ПРОИЗВОЛЬНЫЙ uid/trip_id,
-- поэтому НЕ должны быть доступны end-user напрямую (IDOR — утечка чужого Pro-статуса).
-- Как active_owned_trips (0045): revoke all from public, grant execute только service_role
-- (edge-функции ходят под service role).
--
-- Аддитивно/идемпотентно (CREATE OR REPLACE). Применять в ОБА проекта (prod+dev).

create or replace function public.is_user_pro(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.subscription_status = 'pro'
            and u.subscription_end_date is not null
            and u.subscription_end_date > now()
     from public.users u
     where u.id = p_uid),
    false)
$$;

create or replace function public.is_trip_pro(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.is_pro_trip or public.is_user_pro(t.created_by)
     from public.trips t
     where t.id = p_trip_id),
    false)
$$;

-- ВАЖНО: Supabase по умолчанию грантит EXECUTE на новые public-функции ролям
-- anon и authenticated (ALTER DEFAULT PRIVILEGES). `revoke … from public` этого
-- НЕ снимает — нужен явный revoke с этих ролей, иначе любой залогиненный сможет
-- спросить Pro-статус произвольного uid/trip (IDOR-утечка булева).
revoke all on function public.is_user_pro(uuid) from public;
revoke all on function public.is_trip_pro(uuid) from public;
revoke execute on function public.is_user_pro(uuid) from anon, authenticated;
revoke execute on function public.is_trip_pro(uuid) from anon, authenticated;
grant execute on function public.is_user_pro(uuid) to service_role;
grant execute on function public.is_trip_pro(uuid) to service_role;
