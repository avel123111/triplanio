-- TRIP-296 (3/3): сторож зависших прогонов ассистента.
--
-- У прогона три выхода: ответ пришёл (done), ошибка вернулась (failed) и
-- «не вернулся никто». Третий случай — n8n перезапустился, контейнер умер, сеть
-- моргнула, LLM завис — сигнала не будет по определению: чинить должен тот, кто
-- ВНЕ запроса и переживёт его смерть. Без этого пометка «ждём ответ» осталась бы
-- в базе навсегда, то есть мы бы воспроизвели ровно тот баг, который чиним.
--
-- Механизм не новый: точно так же с TRIP-248 работает сторож недоставленных
-- Telegram-напоминаний (pg_cron + функция + частичный индекс).

create extension if not exists pg_cron;

create or replace function public.chat_ai_run_watchdog()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_closed integer;
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
    returning 1
  )
  select count(*) into v_closed from stale;

  -- Алерт намеренно не отправляется в Sentry, как это делает сторож напоминаний:
  -- там окружение зашито 'production', потому что на dev у напоминаний нет
  -- трафика, а у чата он есть на обоих — и вывести имя окружения из SQL нечем
  -- (обе базы называются postgres). Предупреждение уходит в логи Postgres,
  -- которые видны в Supabase. Отдельная задача, если понадобится алерт: пробросить
  -- имя окружения в базу параметром и включить net.http_post.
  if v_closed > 0 then
    raise warning 'chat_ai_run_watchdog: closed % stale assistant run(s) as timeout', v_closed;
  end if;

  return v_closed;
end;
$$;

comment on function public.chat_ai_run_watchdog() is
  'Закрывает прогоны ассистента, по которым никто не вернулся, в timeout. Единственный выход из «вечно печатает». TRIP-296.';

revoke all on function public.chat_ai_run_watchdog() from public;

-- Каждую минуту: в отличие от напоминаний, здесь человек сидит и ждёт ответа,
-- поэтому цена задержки — это время, которое он смотрит на «печатает».
-- Повторное расписание того же имени в pg_cron идемпотентно.
select cron.schedule(
  'chat-ai-run-watchdog',
  '* * * * *',
  $$ select public.chat_ai_run_watchdog(); $$
);
