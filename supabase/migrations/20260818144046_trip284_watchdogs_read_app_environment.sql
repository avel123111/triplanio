-- TRIP-284 (Блок 0): pg_cron-сторожа читают окружение из per-project setting,
-- а не из литерала 'production' в теле функции.
--
-- Проблема. Оба живых сторожа, шлющих алерт прямо в Sentry (pg_net), зашивали
-- `'environment', 'production'` в тело. Тело миграции ОДИНАКОВО на обоих проектах
-- (dev nydhzevd… и prod tizscxrp…), поэтому значение окружения в нём жить не может:
-- cron-сбой на dev уезжал в Sentry под меткой `production` и в dev-фильтре не виден.
-- SQL, в отличие от edge, не читает секрет функции `SENTRY_ENVIRONMENT` — секрет эту
-- часть env-метки не чинит по построению.
--
-- Решение (симметрично edge-рантайму, где источник — секрет). Источник правды об
-- окружении для БД — per-project setting `app.environment`, задаваемый один раз на
-- каждом проекте как секрет (ops, вне этой миграции):
--   ALTER DATABASE postgres SET app.environment = 'development';  -- на dev
--   ALTER DATABASE postgres SET app.environment = 'production';   -- на prod
-- Сторожа читают `current_setting('app.environment', true)` (missing_ok => NULL,
-- если setting ещё не задан) с фолбэком COALESCE→'production'. Поэтому миграция
-- БЕЗОПАСНА до выставления setting: пока его нет, поведение ровно прежнее
-- ('production'); значение активируется в момент ALTER DATABASE, без ре-деплоя.
--
-- Область. Живых сторожа, постящих в Sentry, ДВА, а не три: `20260725190312`
-- (первая версия chat_ai_run_watchdog) не имела net.http_post вовсе (только
-- `raise warning`) и перекрыта миграцией `20260725205346` — там литерала нет,
-- переопределять её незачем. Меняется РОВНО строка `'environment', …` в каждой из
-- двух функций; остальные тела копируются 1-в-1 из их последних определений.
--
-- caps-guard: allow-uncapped — колонок файл не добавляет; `v_trips text` в обеих
-- функциях — локальная plpgsql-переменная (список трипов для алерта), не колонка.

-- 1/2. Сторож недоставленных Telegram-напоминаний (было: 20260721235244_trip248).
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
  -- read from the per-project setting `app.environment` (TRIP-284), fallback
  -- 'production' when unset — so a dev cron failure is tagged `development`.
  perform net.http_post(
    url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
    body := jsonb_build_object(
      'platform', 'other',
      'level', 'error',
      'logger', 'pg_cron',
      'environment', coalesce(current_setting('app.environment', true), 'production'),
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

-- 2/2. Сторож зависших прогонов ассистента (было: 20260725205346_trip296_sentry).
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
  -- напоминаний. `environment` — из per-project setting `app.environment`
  -- (TRIP-284), фолбэк 'production' пока setting не задан.
  perform net.http_post(
    url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
    body := jsonb_build_object(
      'platform', 'other',
      'level', 'error',
      'logger', 'pg_cron',
      'environment', coalesce(current_setting('app.environment', true), 'production'),
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
