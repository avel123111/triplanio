/**
 * Ресурс `trip-chat` — ШЕСТОЙ домен за единой дверью (TRIP-408, эпик TRIP-374).
 *
 * ПОСЛЕДНЯЯ клиентская мутация во всём репо (`rpcMutating 1→0`): отправка
 * сообщения в чат. Одно действие `send` = атомарный RPC `send_chat_message`
 * (вставка + пометка прогона ассистента в одной транзакции), поэтому `op:'rpc'`
 * по правилу TRIP-405. Логика (авторизация/актор/кэпы/ошибки) — ОБЩАЯ в шве
 * (`../mutate.ts`); отличается только имя RPC + маппинг аргументов. Файл
 * import-free (кроме типов) — правило пинится тестом без загрузки клиента БД.
 *
 * ★ ДВА ГЕЙТА, ПОРЯДОК ВАЖЕН: `requires:['participant','pro']`. Чат — Pro-аддон
 * (`PRO_ONLY_ADDONS`), но раньше Pro-гейт был только клиентским → не-Pro участник
 * Pro-трипа слал сообщения прямым вызовом RPC (дыра энфорса, live-dev). Теперь:
 *   - `participant` (`isCallerParticipant` ≡ SQL `is_trip_participant`) → viewer
 *     проходит (чат коллаборативный), не-участник → 403 и Pro-детали не узнаёт;
 *   - `pro` (`proRefusal`, предикат `is_trip_pro`) → участник-не-Pro → 402.
 * Оба Pro-касания чата (send здесь и AI-ответ в `callTriplanioAi`) сходятся в
 * ОДНОМ `proRefusal` — второй формулы Pro нет.
 *
 * ★★ IDOR/целостность закрыты швом: скоуп `trip_id` едет в тело RPC аргументом
 * `p_trip` из проверенного скоупа, чат резолвится group-чатом ИМЕННО этого трипа
 * («мой трип + чужой чат» невыразим). `p_actor` инъектит `buildPlan`.
 *
 * Кэп 10000 — зеркало проверки `char_length(v_text) > 10000` в теле RPC.
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const TRIP_CHAT: ResourceSpec = {
  name: 'trip-chat',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // send_chat_message(p_trip, p_text, p_client_msg_id, p_actor) → строка chat_messages.
    send: {
      op: 'rpc',
      rpc: 'send_chat_message',
      requires: ['participant', 'pro'],
      fields: {
        text: { type: 'string', max: 10000, required: true },
        // Идемпотентность: тот же id — та же строка (повтор после обрыва). Клиент
        // может не прислать (новое сообщение) → RPC сгенерит серверную строку без него.
        clientMsgId: { type: 'uuid', nullable: true },
      },
      buildArgs: (values, ctx) => ({
        p_trip: ctx.scopeValue,
        p_text: values.text,
        p_client_msg_id: values.clientMsgId ?? null,
      }),
    },
  },
};
