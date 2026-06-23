-- 0061: откат Pro-аддонов при потере Pro.
--
-- Проблема: флаги trip.details.addons (budget/chat/telegram_assistant) — «липкие».
-- Их выставляет updateTripSettings под Pro-гейтом, но НИКТО не гасит, когда Pro
-- теряется (подписка отменена/истекла или pro_trip возвращён). Гейтинг экранов
-- читает только статичный флаг (isAddonEnabled / isLensVisible), поэтому бюджет,
-- чат и телеграм продолжают работать бесплатно. Энтайтлмент-сигналы
-- (users.subscription_* / trips.is_pro_trip) при этом честно гасятся, но аддоны —
-- нет.
--
-- Решение (данные): здесь — set-based флип флагов budget/chat/telegram_assistant в
-- false для трипов, которые РЕАЛЬНО потеряли Pro. Живой предикат — is_trip_pro
-- (0055) = trips.is_pro_trip OR is_user_pro(owner). Гейт критичен: pro_trip-возврат
-- гасит только is_pro_trip, но трип может остаться Pro по подписке владельца — тогда
-- НЕ трогаем.
--
-- Telegram-привязки (trip_telegram_integrations) здесь НЕ удаляются: это живой
-- внешний side-effect (в будущем — групповые чаты, вызовы Telegram API), он живёт в
-- одном TS-месте (_shared/telegramTeardown.ts) и вызывается оркестратором по
-- trip_id, которые возвращают эти функции. SQL отдаёт только дешёвую дата-часть.
--
-- Бюджет/траты и сообщения чата НЕ трогаем — только флаги доступа.
--
-- SECURITY DEFINER + service_role-only (как 0055): функции принимают произвольный
-- uid/trip_id (IDOR-write риск), end-user к ним не должен иметь доступа.
-- Аддитивно/идемпотентно. Применять в ОБА проекта (prod + dev).

-- Один трип (путь pro_trip refund в webhook): гасим флаги, если трип уже не Pro;
-- возвращаем id, если был что гасить ИЛИ есть живая TG-привязка (для teardown).
create or replace function public.revoke_trip_pro_addons(p_trip_id uuid)
returns table(trip_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.trips t
     set details = jsonb_set(jsonb_set(jsonb_set(
             coalesce(t.details, '{}'::jsonb),
             '{addons,budget}',             'false'::jsonb, true),
             '{addons,chat}',               'false'::jsonb, true),
             '{addons,telegram_assistant}', 'false'::jsonb, true)
   where t.id = p_trip_id
     and not public.is_trip_pro(t.id)
     and (
          coalesce((t.details->'addons'->>'budget')::boolean, false)
       or coalesce((t.details->'addons'->>'chat')::boolean, false)
       or coalesce((t.details->'addons'->>'telegram_assistant')::boolean, false)
       or exists (select 1 from public.trip_telegram_integrations i where i.trip_id = t.id)
     )
  returning t.id;
end $$;

-- Все трипы владельца (путь потери подписки): тот же флип на трипах, где is_trip_pro
-- упал в false. Покрывает fan-out — одна подписка кроет все «обычные» трипы владельца.
create or replace function public.revoke_user_pro_addons(p_user_id uuid)
returns table(trip_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.trips t
     set details = jsonb_set(jsonb_set(jsonb_set(
             coalesce(t.details, '{}'::jsonb),
             '{addons,budget}',             'false'::jsonb, true),
             '{addons,chat}',               'false'::jsonb, true),
             '{addons,telegram_assistant}', 'false'::jsonb, true)
   where t.created_by = p_user_id
     and not public.is_trip_pro(t.id)
     and (
          coalesce((t.details->'addons'->>'budget')::boolean, false)
       or coalesce((t.details->'addons'->>'chat')::boolean, false)
       or coalesce((t.details->'addons'->>'telegram_assistant')::boolean, false)
       or exists (select 1 from public.trip_telegram_integrations i where i.trip_id = t.id)
     )
  returning t.id;
end $$;

-- service_role-only (см. 0055): Supabase по умолчанию грантит EXECUTE на новые
-- public-функции anon/authenticated — снимаем явно, иначе IDOR-write чужих трипов.
revoke all on function public.revoke_trip_pro_addons(uuid) from public;
revoke all on function public.revoke_user_pro_addons(uuid) from public;
revoke execute on function public.revoke_trip_pro_addons(uuid) from anon, authenticated;
revoke execute on function public.revoke_user_pro_addons(uuid) from anon, authenticated;
grant execute on function public.revoke_trip_pro_addons(uuid) to service_role;
grant execute on function public.revoke_user_pro_addons(uuid) to service_role;
