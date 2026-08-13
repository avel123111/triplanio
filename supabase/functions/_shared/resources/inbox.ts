/**
 * Ресурс `inbox` — запись флага `read` уведомлений за единой дверью (TRIP-408).
 *
 * Второй self-ресурс (после `account`): владение — не трипом, а самим актором
 * (`scope.from:'actor'`, `requires:['self']` тривиально выполнено). Нужен, чтобы
 * `notifications` закрылась ЦЕЛИКОМ — прямой клиентский UPDATE флага `read` уходит
 * за дверь. Логика — общая в шве (`../mutate.ts`), файл import-free (кроме типов).
 *
 * ★ ОБА действия — `op:'rpc'` (а не table-DML `update`), НАМЕРЕННО: у движка нет
 * update-only операции, а `op:'upsert'` вставил бы строку при отсутствии id —
 * клиент мог бы подделать строку `notifications`. RPC — чистый UPDATE со скоупом
 * `user_id = p_actor` ВНУТРИ (integrity, как integrity-scope trip-route). `p_actor`
 * инъектит `buildPlan` из JWT; клиент актора не называет.
 *   - `read`     → одно уведомление по id;
 *   - `read-all` → все непрочитанные актора (по предикату, а не по id на экране —
 *     иначе честный счётчик остался бы ненулевым сразу после «прочитать все»).
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const INBOX: ResourceSpec = {
  name: 'inbox',
  scope: { column: 'user_id', from: 'actor' },
  actions: {
    // mark_notification_read(p_actor, p_id) → void.
    read: {
      op: 'rpc',
      rpc: 'mark_notification_read',
      requires: ['self'],
      fields: { id: { type: 'uuid', required: true } },
      buildArgs: (values) => ({ p_id: values.id }),
    },
    // mark_all_notifications_read(p_actor) → void. Тела нет — только актор от шва.
    'read-all': {
      op: 'rpc',
      rpc: 'mark_all_notifications_read',
      requires: ['self'],
      buildArgs: () => ({}),
    },
  },
};
