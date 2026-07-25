-- TRIP-296: сторож зависших прогонов ассистента сам шлёт алерт в Sentry.
--
-- До этого он писал только warning в лог Postgres, а алерт отправлял фронт из
-- общего шва чата. У фронтового варианта нашлась дыра (ревью PR #594): у каждой
-- вкладки свой счётчик «уже отправлено», поэтому один и тот же таймаут уезжал в
-- Sentry столько раз, сколько участников держали чат открытым. Сторож — ровно
-- одна точка на прогон, дедуп не нужен по построению, и алерт больше не зависит
-- от того, смотрит ли кто-то на экран.
--
-- environment захардкожен 'production' — как в стороже напоминаний (TRIP-248):
-- имя окружения из SQL не выводится, а разделять события того не стоит; трип и
-- количество видно в extra.
--
-- Остальные исходы алертить не нужно, они уже покрыты: WEBHOOK_ERROR — это 502
-- самой edge-функции (её ловит withHandler), сбой внутри n8n репортит сам n8n,
-- а PRO_REQUIRED / RATE_LIMITED — штатный отказ, а не поломка.
--
-- caps-guard: allow-uncapped — колонок файл не добавляет; `v_trips text` это
-- локальная переменная plpgsql (список трипов для алерта), а не колонка. Тот же
-- случай, что в стороже напоминаний TRIP-248.
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
  -- напоминаний: повторные срабатывания склеиваются в один issue.
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
