-- TRIP-153 (2/4): recompute_* перестают писать, когда писать нечего.
--
-- Обе функции сегодня делают безусловный UPDATE: вызвали — записали, даже если
-- значение то же самое. Пока их звал только вебхук (десяток раз в сутки) это
-- ничего не стоило. Периодическая сверка зовёт их ПО ВСЕМ юзерам и трипам
-- каждый час, то есть безусловный UPDATE становится UPDATE каждой строки
-- users и trips ежечасно.
--
-- Замерено на проде перед правкой, чтобы не чинить воображаемое:
--   • users и trips НЕ входят в публикацию supabase_realtime → рассылки клиентам
--     нет (иначе каждый подключённый клиент получал бы поток ежечасно);
--   • все триггеры на users и trips — только ON INSERT (trg_seed_budget_on_trip,
--     trips_create_group_chat, trips_enforce_limit, trg_link_pending_invites) →
--     повторный UPDATE их не будит и не может упереться в лимит трипов.
-- Значит цена сегодня — только мёртвые кортежи и работа автовакуума. Правка не
-- срочная по рантайму, но обязательная по смыслу: принцип сверки «пишем только
-- то, что реально расходится» иначе неправда с первого прогона.
--
-- ФОРМУЛА НЕ МЕНЯЕТСЯ НИ НА СИМВОЛ. Тело скопировано с ЖИВОГО определения
-- (pg_get_functiondef на проде), а не набрано по описанию: у
-- recompute_user_entitlement три входа, включая
-- provider_meta->>'next_payment_attempt' + 1 day для past_due (TRIP-158), и
-- пересказ по памяти уже однажды дал бы неверную копию. Добавлено РОВНО
-- условие «значение отличается» в WHERE.
--
-- search_path = public, pg_temp — как закреплено TRIP-54 (pg_temp последним).

-- ============================================================================
-- 1. recompute_user_entitlement — кэш подписки
-- ============================================================================
create or replace function public.recompute_user_entitlement(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_end timestamptz;
begin
  select max(
    case
      -- Грейс past_due: детерминирован из дат Stripe (без now()-математики).
      when s.status = 'past_due' then
        coalesce(
          (s.provider_meta->>'next_payment_attempt')::timestamptz + interval '1 day',
          s.current_period_end
        )
      else s.current_period_end
    end
  )
  into v_end
  from subscription s
  where s.user_id = p_user_id
    and s.product_code in ('account_pro_monthly', 'account_pro_yearly')
    and s.status in ('active', 'trialing', 'past_due');

  if v_end is not null then
    update users
       set subscription_status = 'pro', subscription_end_date = v_end
     where id = p_user_id
       and (subscription_status, subscription_end_date)
           is distinct from ('pro'::text, v_end);
  else
    update users
       set subscription_status = 'free', subscription_end_date = null
     where id = p_user_id
       and (subscription_status, subscription_end_date)
           is distinct from ('free'::text, null::timestamptz);
  end if;
end;
$$;

comment on function public.recompute_user_entitlement(uuid) is
  'Единственный писатель users.subscription_status/end_date. Идентичное значение не переписывает (TRIP-153).';

alter function public.recompute_user_entitlement(uuid) owner to postgres;
revoke all on function public.recompute_user_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.recompute_user_entitlement(uuid) to service_role;

-- ============================================================================
-- 2. recompute_trip_entitlement — кэш разовой Trip Pro
-- ============================================================================
-- Предикат вынесен в переменную, чтобы условие «значение отличается» не
-- потребовало второй копии того же EXISTS в WHERE.
create or replace function public.recompute_trip_entitlement(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pro boolean;
begin
  select exists(
    select 1 from purchase p
    where p.trip_id = p_trip_id
      and p.product_code = 'trip_pro_lifetime'
      and p.status = 'active'
  ) into v_pro;

  update trips
     set is_pro_trip = v_pro
   where id = p_trip_id
     and is_pro_trip is distinct from v_pro;
end;
$$;

comment on function public.recompute_trip_entitlement(uuid) is
  'Единственный писатель trips.is_pro_trip. Идентичное значение не переписывает (TRIP-153).';

alter function public.recompute_trip_entitlement(uuid) owner to postgres;
revoke all on function public.recompute_trip_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.recompute_trip_entitlement(uuid) to service_role;
