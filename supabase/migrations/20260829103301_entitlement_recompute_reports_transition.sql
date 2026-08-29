-- Право отвечает, ПОЯВИЛОСЬ ли оно этим вызовом (эпик «уведомление на переход»).
--
-- Кэш права выводят ровно эти две функции: users.subscription_status /
-- subscription_end_date и trips.is_pro_trip. Обе возвращали void, поэтому
-- вызывающий edge не мог узнать, появилось ли право ИМЕННО СЕЙЧАС, и
-- уведомление «Pro активирован» висело на одной ветке checkout.session.completed
-- («я первым создал строку subscription»). Строку же рождают ЧЕТЫРЕ пути —
-- checkout.session.completed, invoice.paid, invoice.payment_failed и
-- reconcile-on-read, — так что на трёх из них не уведомлял никто: в проде 0
-- уведомлений на 5 подписок, а пользователь, чья первая попытка ушла в 3DS,
-- получил вместо «Pro активирован» только «платёж не прошёл».
--
-- Теперь обе функции отвечают на вопрос «право появилось?» — единственные, кто
-- может ответить честно, потому что они же его и пишут. Расчёт права НЕ изменён
-- ни в одной строке: добавлены чтение прошлого значения и return.
--
-- `for update` здесь несущий, а не декоративный: вебхуки приезжают пачкой (27.08
-- checkout.session.completed и invoice.paid перекрылись в пределах 300 мс), и без
-- блокировки оба вызова прочитали бы «не pro» и выдали бы по уведомлению. Под
-- блокировкой второй ждёт коммита первого, перечитывает строку и видит переход
-- уже совершённым → false. Тест-и-установка живёт в одной транзакции с записью
-- права, поэтому дубль невозможен по построению, а не «маловероятен».
--
-- Тип возврата нельзя сменить через create or replace (Postgres запрещает), отсюда
-- drop+create; тела других функций эти две не зовут (проверено по дереву и pg_proc),
-- поэтому дроп ничего не роняет. Овнер / ревок / грант / search_path переописаны
-- дословно как были (canon TRIP-54: pg_temp последним, ревок с PUBLIC).

drop function if exists public.recompute_user_entitlement(uuid);

create function public.recompute_user_entitlement(p_user_id uuid) returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_end  timestamptz;
  v_prev text;
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

  -- Блокировка строки пользователя (см. шапку): конкурентный вызов ждёт и
  -- перечитывает уже новый статус, поэтому переход достаётся ровно одному.
  select subscription_status into v_prev from users where id = p_user_id for update;
  if not found then
    return false; -- пользователя нет (удалён) — писать право и уведомлять некому
  end if;

  if v_end is not null then
    update users set subscription_status = 'pro', subscription_end_date = v_end where id = p_user_id;
  else
    update users set subscription_status = 'free', subscription_end_date = null where id = p_user_id;
  end if;

  return v_end is not null and v_prev is distinct from 'pro';
end;
$$;

alter function public.recompute_user_entitlement(uuid) owner to postgres;
revoke all on function public.recompute_user_entitlement(uuid) from public, anon, authenticated;
grant all on function public.recompute_user_entitlement(uuid) to service_role;

drop function if exists public.recompute_trip_entitlement(uuid);

create function public.recompute_trip_entitlement(p_trip_id uuid) returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_prev boolean;
  v_now  boolean;
begin
  select is_pro_trip into v_prev from trips where id = p_trip_id for update;
  if not found then
    return false;
  end if;

  update trips
     set is_pro_trip = exists(
       select 1 from purchase p
       where p.trip_id = p_trip_id
         and p.product_code = 'trip_pro_lifetime'
         and p.status = 'active'
     )
   where id = p_trip_id
  returning is_pro_trip into v_now;

  return coalesce(v_now, false) and not coalesce(v_prev, false);
end;
$$;

alter function public.recompute_trip_entitlement(uuid) owner to postgres;
revoke all on function public.recompute_trip_entitlement(uuid) from public, anon, authenticated;
grant all on function public.recompute_trip_entitlement(uuid) to service_role;
