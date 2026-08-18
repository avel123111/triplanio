-- TRIP-284 (откат Блока 0, SQL): pg_cron-сторожа возвращаются к литералу
-- 'production' в метке `environment`.
--
-- Почему откат. Предыдущая миграция (20260818144046) переводила сторожей на
-- `current_setting('app.environment', true)` с фолбэком 'production', рассчитывая
-- на per-project GUC, задаваемый один раз `ALTER DATABASE postgres SET
-- app.environment = …`. На Supabase это невозможно: установка кастомного GUC
-- через ALTER DATABASE/ROLE SET требует суперпользователя, а роль `postgres`
-- (SQL-редактор / доступные подключения) им НЕ является → `ERROR 42501:
-- permission denied to set parameter "app.environment"`. Значит `app.environment`
-- не может быть задан доступной ролью НИКОГДА, а `current_setting(...,true)` —
-- мёртвая ветка, всегда падающая в фолбэк 'production'. Подход через GUC снят как
-- Supabase-несовместимый.
--
-- Поведение не меняется: и сейчас (фолбэк), и после отката сторожа шлют
-- 'production'. Убираем ровно мёртвый `current_setting`, метку возвращаем прямым
-- литералом. edge-сторона (envTag из секрета SENTRY_ENVIRONMENT, PR #890) НЕ
-- затронута и остаётся корректной — правится только SQL-сторона env-метки.
--
-- Осознанно принимаем: 2 dev-cron-алерта (undelivered TG reminders / chat-AI
-- timeout) остаются с меткой 'production' — dev-only, низкочастотные, отдельный
-- конфиг-механизм ради них не заводим.
--
-- Тела функций — байт-в-байт как в 20260818144046, меняется ТОЛЬКО строка
-- 'environment', …. Обе функции остаются SECURITY INVOKER; revoke-строки те же.
--
-- caps-guard: allow-uncapped — колонок файл не добавляет; `v_trips text` в обеих
-- функциях — локальная plpgsql-переменная (список трипов для алерта), не колонка.

-- 1/2. Сторож недоставленных Telegram-напоминаний.
create or replace function public.tg_reminders_undelivered_watchdog()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count  int;
  v_oldest timestamptz;
  v_trips  text;
begin
  -- Uses idx_reminder_logs_undelivered. Lower bound (30 min) clears the current
  -- delivery tick (window 20 min, delivery takes seconds); upper bound (24 h)
  -- keeps the alert from re-firing forever on ancient rows.
  select count(*), min(sent_at), coalesce(string_agg(distinct trip_id::text, ', '), '')
    into v_count, v_oldest, v_trips
  from public.telegram_reminder_logs
  where delivered_at is null
    and sent_at < now() - interval '30 minutes'
    and sent_at > now() - interval '24 hours';

  if coalesce(v_count, 0) = 0 then
    return;
  end if;

  -- Same Sentry DSN as the n8n reminder workflows. Stable fingerprint so Sentry
  -- groups repeat firings into one issue instead of spamming. `environment` is
  -- hardcoded 'production': ALTER DATABASE SET is not available on Supabase
  -- (42501), so a per-project GUC can't drive it; dev finds ~nothing here anyway.
  perform net.http_post(
    url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
    body := jsonb_build_object(
      'platform', 'other',
      'level', 'error',
      'logger', 'pg_cron',
      'environment', 'production',
      'message', format('TG Reminders: %s reminder(s) claimed but not delivered', v_count),
      'tags', jsonb_build_object('surface', 'supabase', 'check', 'tg_reminders_undelivered'),
      'fingerprint', jsonb_build_array('supabase', 'tg-reminders', 'undelivered'),
      'extra', jsonb_build_object('count', v_count, 'oldest_sent_at', v_oldest, 'trips', v_trips)
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

revoke all on function public.tg_reminders_undelivered_watchdog() from public;

-- 2/2. Сторож зависших прогонов ассистента.
create or replace function public.chat_ai_run_watchdog()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_closed int;
  v_oldest timestamptz;
  v_trips  text;
begin
  -- Идёт по idx_chat_messages_ai_open. Порог 3 минуты: живой ответ занимает
  -- 10-40 секунд (по логам n8n), так что нормальный прогон закрыться успевает.
  with stale as (
    update public.chat_messages
       set ai_status      = 'timeout',
           ai_error       = 'TIMEOUT',
           ai_finished_at = now()
     where ai_status in ('queued', 'running')
       and ai_requested_at < now() - interval '3 minutes'
    returning trip_id, ai_requested_at
  )
  select count(*), min(ai_requested_at), coalesce(string_agg(distinct trip_id::text, ', '), '')
    into v_closed, v_oldest, v_trips
  from stale;

  if coalesce(v_closed, 0) = 0 then
    return 0;
  end if;

  -- Тот же ingest-эндпоинт и тот же приём стабильного fingerprint, что у сторожа
  -- напоминаний. `environment` захардкожен 'production' — ALTER DATABASE SET на
  -- Supabase недоступен (42501), per-project GUC не работает.
  perform net.http_post(
    url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
    body := jsonb_build_object(
      'platform', 'other',
      'level', 'error',
      'logger', 'pg_cron',
      'environment', 'production',
      'message', format('Chat assistant: %s run(s) timed out with no answer', v_closed),
      'tags', jsonb_build_object('surface', 'supabase', 'check', 'chat_ai_run_timeout'),
      'fingerprint', jsonb_build_array('supabase', 'chat-ai-run', 'timeout'),
      'extra', jsonb_build_object('count', v_closed, 'oldest_requested_at', v_oldest, 'trips', v_trips)
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  return v_closed;
end;
$$;

revoke all on function public.chat_ai_run_watchdog() from public, anon, authenticated, service_role;
