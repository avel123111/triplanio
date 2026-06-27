-- TRIP-111: единый серверный примитив rate-limit для всех AI-флоу.
--
-- Одна таблица-счётчик + одна атомарная функция check_and_bump_rate_limit,
-- которую дёргают все точки входа в платный LLM:
--   • planTripWithAi      (subject=user,  10/час)
--   • parseBookingWithAi  (subject=user,  10/час)
--   • callTriplanioAi     (subject=trip,  30/час)
--   • aiGate (TG-бот)     (subject=chat,  30/час) — зовётся из n8n
--
-- Окно — фиксированное (floor по epoch / window_seconds), ключ включает
-- window_start, поэтому старые окна просто перестают матчиться и не мешают.
-- Чистка старых строк — отдельным housekeeping-джобом при необходимости
-- (таблица маленькая: число активных субъектов × окон).

create table if not exists public.ai_rate_limits (
  subject_type text        not null,            -- 'user' | 'trip' | 'chat'
  subject_id   text        not null,            -- uuid юзера/трипа или telegram_chat_id
  flow         text        not null,            -- 'trip_planner' | 'inapp_group_chat' | 'trip_parser' | 'tg_chatbot'
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (subject_type, subject_id, flow, window_start)
);

-- Таблицу трогает только service_role (edge-функции через admin-клиент).
-- Включаем RLS без политик: service_role и так в обход RLS, а для anon/
-- authenticated доступа нет — счётчик не должен быть доступен из браузера.
alter table public.ai_rate_limits enable row level security;

-- Атомарный «проверить и увеличить». Возвращает решение одной строкой:
--   allowed     — пускать ли вызов;
--   remaining   — сколько ещё осталось в текущем окне (0, если лимит выбран);
--   retry_after — секунд до конца окна (для сообщения «попробуй через ~N мин»).
--
-- Инкремент идёт ТОЛЬКО пока count < limit (условие в ON CONFLICT ... WHERE),
-- поэтому отклонённые вызовы не раздувают счётчик и retry_after не уезжает.
create or replace function public.check_and_bump_rate_limit(
  p_subject_type   text,
  p_subject_id     text,
  p_flow           text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_epoch  bigint      := floor(extract(epoch from now()))::bigint;
  v_start  timestamptz := to_timestamp((v_epoch / p_window_seconds) * p_window_seconds);
  v_count  integer;
  v_retry  integer;
begin
  v_retry := greatest(
    0,
    ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))
  )::integer;

  insert into public.ai_rate_limits as r (subject_type, subject_id, flow, window_start, count)
  values (p_subject_type, p_subject_id, p_flow, v_start, 1)
  on conflict (subject_type, subject_id, flow, window_start)
  do update set count = r.count + 1
  where r.count < p_limit
  returning r.count into v_count;

  if v_count is null then
    -- ON CONFLICT-апдейт не сработал (count уже >= limit) — лимит выбран.
    return query select false, 0, v_retry;
    return;
  end if;

  return query select true, greatest(0, p_limit - v_count), v_retry;
end;
$function$;

revoke all on function public.check_and_bump_rate_limit(text, text, text, integer, integer) from public;
grant execute on function public.check_and_bump_rate_limit(text, text, text, integer, integer) to service_role;
