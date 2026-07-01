-- TRIP-158: детерминированный грейс past_due (фикс «скользящего окна»)
--
-- Проблема: recompute_user_entitlement считал границу права past_due-подписки как
--   greatest( coalesce(next_payment_attempt + 1 day, now() + 3 days), now() + 1 minute )
-- Два слагаемых относительны now() и пересчитываются на КАЖДОМ вызове recompute
-- (а он зовётся на каждом reconcile-on-read, троттл 10 мин). Для past_due БЕЗ
-- next_payment_attempt дедлайн уползал на now()+3 дня заново при каждом чтении →
-- юзер НИКОГДА не выходил из грейса, пока кто-то открывает экран. now()+1 minute
-- как нижний пол давал тот же вечный сдвиг, когда next_payment_attempt+1day уже в
-- прошлом.
--
-- Фикс: грейс строго из дат Stripe, без now(). Нормальный дённинг не меняется —
-- next_payment_attempt + 1 day (Stripe всегда шлёт дату ретрая на past_due-инвойсе),
-- это ровно прежнее значение в общем случае. Фолбэк (ретрай не назначен) — конец
-- оплаченного периода current_period_end (тоже детерминированный), а не «+3 дня от
-- сейчас». Нет даты вовсе → null → подписка не держит право по дате (max по прочим
-- энтайтлинг-строкам применяется как и раньше). Никаких авто-продлений грейса.
--
-- Всё остальное в функции без изменений (max по энтайтлинг-подпискам, флип
-- users.subscription_status/subscription_end_date, single-writer).

CREATE OR REPLACE FUNCTION public.recompute_user_entitlement(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
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
    update users set subscription_status = 'pro', subscription_end_date = v_end where id = p_user_id;
  else
    update users set subscription_status = 'free', subscription_end_date = null where id = p_user_id;
  end if;
end;
$$;
ALTER FUNCTION public.recompute_user_entitlement(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recompute_user_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.recompute_user_entitlement(uuid) TO service_role;
