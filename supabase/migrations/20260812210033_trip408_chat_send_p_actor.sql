-- TRIP-408 (1/2): send_chat_message уходит за единую дверь записи (эпик TRIP-374).
--
-- Было (TRIP-296): клиент звал secdef-функцию напрямую — `EXECUTE` у
-- `authenticated`, а внутри авторизация `is_trip_participant(trip)` + автор из
-- `auth.uid()`. Это работало, но:
--   * ДЫРА ЭНФОРСА: чат — Pro-аддон (PRO_ONLY_ADDONS), а функция Pro НЕ проверяла;
--     не-Pro участник Pro-трипа слал сообщения прямым вызовом RPC в обход
--     клиентского гейта (подтверждено на dev 2026-08-12);
--   * последняя клиентская мутация во всём репо (rpcMutating 1→0 эпика).
--
-- Стало: единственный вызыватель — edge-функция `trip-chat` (op:'rpc' движка
-- `_shared/mutate.ts`) под `service_role`. Авторизация ушла в шов: `participant`
-- (`isCallerParticipant` ≡ SQL `is_trip_participant`) + `pro` (`is_trip_pro`),
-- ровно как booking/route. RPC больше НЕ самоавторизуется (норма Варианта B): она
-- берёт явный `p_actor` (автор = актор, инъектит `buildPlan`) и `p_trip` (скоуп,
-- проверенный швом), `auth.uid()`/`is_trip_participant` сняты. Чат резолвится из
-- `p_trip` (`chats WHERE trip_id=p_trip AND type='group'`): «мой трип + чужой
-- чат» невыразим по построению, `p_chat_id` убран.
--
-- Права: `EXECUTE` снят у `public, anon, authenticated` (грабля дефолтных
-- привилегий, TRIP-296-фикс) и выдан только `service_role`.
--
-- caps-guard: allow-uncapped — файл меняет только сигнатуру функции; новых
-- колонок нет, значения кэпятся в теле (текст 10000, ошибки — в claim/finish,
-- не тронуты). Гард 2g читает `p_text text` в сигнатуре за объявление колонки.

-- Смена сигнатуры → DROP+CREATE (нельзя CREATE OR REPLACE с другим набором
-- аргументов). Старая версия (uuid, text, uuid) удаляется целиком.
drop function if exists public.send_chat_message(uuid, text, uuid);

create function public.send_chat_message(
  p_trip          uuid,
  p_text          text,
  p_client_msg_id uuid default null,
  p_actor         uuid default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chat_id uuid;
  v_text    text := btrim(coalesce(p_text, ''));
  v_ai      boolean;
  v_row     public.chat_messages;
begin
  -- Актор приходит ДАННЫМИ от шва (не auth.uid(): под service_role он NULL).
  -- Клиент актора не называет — его инъектит buildPlan из проверенного JWT.
  if p_actor is null then
    raise exception 'actor is required' using errcode = '42501';
  end if;

  -- Групповой чат трипа. Не найден → NOT_FOUND (целостность по построению;
  -- авторизацию «участник/Pro» уже проверил шов на p_trip).
  select id into v_chat_id
  from public.chats
  where trip_id = p_trip and type = 'group';

  if v_chat_id is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  if v_text = '' then
    raise exception 'message is empty' using errcode = '22023';
  end if;
  if char_length(v_text) > 10000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;

  -- Идемпотентность: тот же client_msg_id — та же строка (повтор после обрыва).
  if p_client_msg_id is not null then
    select * into v_row
    from public.chat_messages
    where chat_id = v_chat_id and client_msg_id = p_client_msg_id;
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
      v_chat_id, p_trip, p_actor, p_actor,
      (select full_name from public.users where id = p_actor),
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
    where chat_id = v_chat_id and client_msg_id = p_client_msg_id;
  end;

  return v_row;
end;
$$;

comment on function public.send_chat_message(uuid, text, uuid, uuid) is
  'Единственный путь записи сообщения в чат за швом (TRIP-408): автор из p_actor, скоуп из p_trip (чат резолвится group-чатом трипа), кэп длины, дедуп по client_msg_id, пометка прогона ассистента в той же транзакции. Авторизация participant+pro — в edge trip-chat.';

-- Права: клиентские роли снимаем ЯВНО (дефолтные привилегии грантят новой
-- функции EXECUTE всем ролям — TRIP-296-фикс), оставляем только service_role.
revoke execute on function public.send_chat_message(uuid, text, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.send_chat_message(uuid, text, uuid, uuid) to service_role;
