-- 0056: create_trip переходит на единый предикат is_user_pro (T6, поведение 1:1).
--
-- Раньше (0045) create_trip инлайнил формулу Pro
--   (subscription_status='pro' AND end_date IS NOT NULL AND end_date > now()).
-- Теперь та же формула живёт ОДИН раз в is_user_pro (0055) — здесь просто вызов.
-- Поведение не меняется. create_trip остаётся SECURITY DEFINER (его владелец может
-- выполнять is_user_pro, как уже делает с count_active_owned_trips — service_role-only).
--
-- Лимит free (>= 1 активный owned-трип) НЕ трогаем — это отдельный источник
-- (count_active_owned_trips, 0045/0046).

create or replace function public.create_trip(p_title text, p_description text default ''::text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid; v_trip_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not public.is_user_pro(v_uid) then
    if public.count_active_owned_trips(v_uid) >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $function$;
