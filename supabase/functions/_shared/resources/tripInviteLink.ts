/**
 * Ресурс `trip-invite-link` — общая ссылка-приглашение за единой дверью
 * (TRIP-409, эпик TRIP-374). Ось авторизации `requires:['editor']` (как
 * `trip-member`), но пишет ДРУГУЮ таблицу (`trip_invite_links`), поэтому — свой
 * ресурс (правило эпика «запись ПО РЕСУРСУ»).
 *
 * `create` = `op:'rpc'` (find-or-create: reuse живой стабильной ссылки на
 * (trip, role) либо insert свежего токена — >1 обращения в одной транзакции).
 * Роль хранится с токеном на сервере, в URL не уезжает. Скоуп `p_trip` из
 * проверенного скоупа + `p_actor` от шва — IDOR закрыт в теле RPC (тест по-действию).
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const TRIP_INVITE_LINK: ResourceSpec = {
  name: 'trip-invite-link',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // create_trip_invite_link(p_trip, p_role, p_actor) → { token, role, expiresAt, reused }.
    create: {
      op: 'rpc',
      rpc: 'create_trip_invite_link',
      requires: ['editor'],
      fields: { role: { type: 'string', enum: ['viewer', 'admin'] } },
      // Роль по умолчанию viewer (как сегодня): отсутствующее поле → 'viewer'.
      buildArgs: (values, ctx) => ({ p_trip: ctx.scopeValue, p_role: values.role ?? 'viewer' }),
    },
  },
};
