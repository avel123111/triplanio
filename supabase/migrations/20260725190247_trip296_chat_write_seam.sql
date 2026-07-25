-- TRIP-296 (2/2): единственный шов записи в чат.
--
-- Было: браузер вставлял строку в chat_messages напрямую, а RLS проверяла ровно
-- одно — «ты участник трипа». Ни автора, ни времени, ни связки чат↔трип она не
-- проверяла, поэтому участник мог одним REST-запросом:
--   * написать от имени другого участника;
--   * написать от имени БОТА (его user_id лежит в бандле фронта, а лента рисует
--     «официальный ответ ассистента» именно по совпадению этого id);
--   * подставить любое created_at (порядок ленты + счётчик непрочитанных);
--   * положить сообщение в чужой chat_id при своём trip_id.
-- Плюс запись сообщения и вызов ассистента были ДВУМЯ отдельными операциями с
-- клиента: закрыл вкладку между ними — сообщение есть, ответа не будет никогда.
--
-- Стало: клиент вызывает одну функцию и передаёт только текст. Автора, время,
-- имя, кэп длины, дедуп и пометку «ждём ответ ассистента» ставит сервер, всё в
-- одной транзакции. Прямые гранты на таблицу отозваны — дверь закрыта не
-- политикой, а отсутствием права.
--
-- Ярус безопасности chat_messages переезжает C → B (клиент не пишет напрямую,
-- запись только через secdef-функцию); манифест scripts/ci/security-tiers.mjs
-- обновлён тем же PR, иначе страж ярусов уронит сборку — и правильно сделает.

-- ── Правило «сообщение адресовано ассистенту» ────────────────────────────────
-- Решение о платном вызове LLM больше не принимает клиент, значит правилу нужен
-- SQL-двойник. Граница шире, чем в src/lib/mention.js (там перечислены пробел и
-- пунктуация, здесь — «не буква/цифра/подчёркивание»), и это сознательно: SQL
-- решает, ЗАПУСКАТЬ ли ассистента, а mention.js остался только подсветкой в
-- композере. Совпадают там, где это важно: "mail@triplanio" и "@TriplanioX" не
-- обращения ни по одному из правил.
create or replace function public.mentions_assistant(p_text text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_text, '') ~* '(^|[^[:alnum:]_])@Triplanio($|[^[:alnum:]_])';
$$;

comment on function public.mentions_assistant(text) is
  'Обращено ли сообщение к ИИ-ассистенту. Источник истины для ЗАПУСКА прогона (mention.js на фронте — только подсветка). TRIP-296.';

-- ── Отправка сообщения ───────────────────────────────────────────────────────
create or replace function public.send_chat_message(
  p_chat_id       uuid,
  p_text          text,
  p_client_msg_id uuid default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_trip_id uuid;
  v_text    text := btrim(coalesce(p_text, ''));
  v_ai      boolean;
  v_row     public.chat_messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select trip_id into v_trip_id
  from public.chats
  where id = p_chat_id and type = 'group';

  if v_trip_id is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  -- Тот же предикат, что держит SELECT-политику таблицы: право писать в чат =
  -- право его читать (роль не проверяем — чат коллаборативный, viewer пишет,
  -- решено при построении ярусной модели).
  if not public.is_trip_participant(v_trip_id) then
    raise exception 'not a trip participant' using errcode = '42501';
  end if;

  if v_text = '' then
    raise exception 'message is empty' using errcode = '22023';
  end if;
  if char_length(v_text) > 10000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;

  -- Идемпотентность: тот же client_msg_id — тот же результат. Клиент повторяет
  -- запрос после обрыва связи, не боясь получить два сообщения.
  if p_client_msg_id is not null then
    select * into v_row
    from public.chat_messages
    where chat_id = p_chat_id and client_msg_id = p_client_msg_id;
    if found then
      return v_row;
    end if;
  end if;

  v_ai := public.mentions_assistant(v_text);

  begin
    insert into public.chat_messages (
      chat_id, trip_id, user_id, created_by, user_full_name, text,
      client_msg_id, ai_status, ai_requested_at
    )
    values (
      p_chat_id, v_trip_id, v_uid, v_uid,
      (select full_name from public.users where id = v_uid),
      v_text,
      p_client_msg_id,
      case when v_ai then 'queued' end,
      case when v_ai then now() end
    )
    returning * into v_row;
  exception when unique_violation then
    -- Гонка двух одинаковых отправок: побеждает первая, вторая читает её строку.
    select * into v_row
    from public.chat_messages
    where chat_id = p_chat_id and client_msg_id = p_client_msg_id;
  end;

  return v_row;
end;
$$;

comment on function public.send_chat_message(uuid, text, uuid) is
  'Единственный путь записи сообщения в чат: автор из auth.uid(), время сервера, кэп длины, дедуп по client_msg_id, пометка прогона ассистента в той же транзакции. TRIP-296.';

-- ── Захват прогона ассистента ────────────────────────────────────────────────
-- Атомарный queued → running. Второй параллельный вызов (двойной клик, две
-- вкладки) не обновит ни строки и получит null — это и есть дедуп запуска LLM,
-- без отдельного замка. failed/timeout тоже захватываются: это «Повторить».
create or replace function public.claim_ai_run(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.chat_messages;
begin
  update public.chat_messages
     set ai_status       = 'running',
         ai_requested_at = now(),
         ai_finished_at  = null,
         ai_error        = null,
         ai_attempts     = ai_attempts + 1
   where id = p_message_id
     and ai_status in ('queued', 'failed', 'timeout')
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_ai_run(uuid) is
  'Атомарный захват прогона ассистента (queued|failed|timeout → running). NULL = уже забран кем-то другим. TRIP-296.';

-- ── Закрытие прогона ─────────────────────────────────────────────────────────
-- Успех и ошибка — один вызов, одна транзакция: ответ бота и снятие пометки
-- «ждём» не могут разъехаться. Повторная доставка того же ответа возвращает уже
-- вставленную строку вместо второй копии.
create or replace function public.finish_ai_run(
  p_message_id  uuid,
  p_bot_user_id uuid default null,
  p_reply       text default null,
  p_error       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg      public.chat_messages;
  v_reply_id uuid;
begin
  select * into v_msg
  from public.chat_messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_msg.ai_status is null then
    raise exception 'message did not request the assistant' using errcode = '22023';
  end if;
  if v_msg.ai_status = 'done' then
    return v_msg.ai_reply_id;
  end if;

  if p_error is not null then
    update public.chat_messages
       set ai_status      = 'failed',
           ai_error       = left(p_error, 300),
           ai_finished_at = now()
     where id = p_message_id;
    return null;
  end if;

  if coalesce(btrim(p_reply), '') = '' then
    raise exception 'reply is empty' using errcode = '22023';
  end if;
  if p_bot_user_id is null then
    raise exception 'bot user is required to post a reply' using errcode = '22023';
  end if;

  insert into public.chat_messages (chat_id, trip_id, user_id, created_by, user_full_name, text)
  values (
    v_msg.chat_id, v_msg.trip_id, p_bot_user_id, p_bot_user_id,
    (select full_name from public.users where id = p_bot_user_id),
    left(btrim(p_reply), 10000)
  )
  returning id into v_reply_id;

  update public.chat_messages
     set ai_status      = 'done',
         ai_error       = null,
         ai_finished_at = now(),
         ai_reply_id    = v_reply_id
   where id = p_message_id;

  return v_reply_id;
end;
$$;

comment on function public.finish_ai_run(uuid, uuid, text, text) is
  'Терминальное закрытие прогона: ответ бота + done, либо failed с машинным кодом. Идемпотентна по ai_reply_id. TRIP-296.';

-- ── Права ────────────────────────────────────────────────────────────────────
-- Клиент больше не пишет в таблицу вообще. Отзыв касается и UPDATE/DELETE:
-- политики «своё сообщение» существовали без единого вызова в UI, но через
-- сырой REST позволяли молча отредактировать или удалить строку — а подписка у
-- остальных участников слушала только INSERT, то есть история расходилась.
revoke insert, update, delete on public.chat_messages from authenticated;

-- Политики под снятые гранты больше никогда не сработают: удаляем, чтобы схема
-- не утверждала того, чего нет. SELECT-политика остаётся — чтение прежнее.
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_update on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

-- REVOKE FROM PUBLIC, а не только FROM anon: грант по умолчанию висит на PUBLIC,
-- и точечный отзыв у anon его не снимает (грабли TRIP-49).
revoke execute on function public.send_chat_message(uuid, text, uuid) from public;
grant  execute on function public.send_chat_message(uuid, text, uuid) to authenticated;

-- Предикат зовётся только изнутри send_chat_message (secdef исполняется от
-- владельца), клиенту он не нужен — least-privilege по конвенции TRIP-49.
revoke execute on function public.mentions_assistant(text) from public;

-- Прогоном управляет только сервер (edge под service_role).
revoke execute on function public.claim_ai_run(uuid)                    from public;
revoke execute on function public.finish_ai_run(uuid, uuid, text, text) from public;
grant  execute on function public.claim_ai_run(uuid)                    to service_role;
grant  execute on function public.finish_ai_run(uuid, uuid, text, text) to service_role;
