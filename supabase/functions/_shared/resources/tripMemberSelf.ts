/**
 * Ресурс `trip-member-self` — действия участника НАД СВОЕЙ строкой членства
 * (TRIP-409, эпик TRIP-374). Отделён от `trip-member` осознанно: гейт здесь
 * `requires:[]` (роль трипа не при чём — «editor ИЛИ self» невыразим, `requires`
 * склеивается через И), а авторизация = `guardRow` row-self. Ресурс однороден по
 * гейту, поэтому `check-security-tiers` видит его как одну row-self-дверь.
 *
 * ★ Инвариант №7 (`findUnguardedRowSelf`): у обоих действий `requires:[]` + запись
 * ⇒ `loadTarget:true`+`guardRow` ОБЯЗАТЕЛЬНЫ — иначе дверь без замка. Форсится
 * тестом по всему REGISTRY и швом на загрузке.
 *
 * ★★ email-ветка владения `respond` (`invite_email === actor.email`) держится в
 * `guardRow` (edge), НЕ в SQL — принцип №0 сохраняет защитный код, эпик держит
 * авторизацию в edge. Полного актора `{id,email}` guardRow получает от шва.
 */

import type { Refusal, ResourceSpec } from '../mutateRules.ts';

const forbid = (status: number, code: string, message: string): Refusal => ({ status, code, message });

export const TRIP_MEMBER_SELF: ResourceSpec = {
  name: 'trip-member-self',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // ── Выйти из трипа (self-removal, без блок-листа) ──────────────────────────
    leave: {
      op: 'delete',
      table: 'trip_members',
      requires: [],
      loadTarget: true,
      // Уйти можно только из своей строки членства.
      guardRow: (row, actor) =>
        row.user_id === actor.id ? null : forbid(403, 'FORBIDDEN', 'This membership is not yours'),
    },

    // ── Ответить на приглашение (accept/decline) ──────────────────────────────
    // respond_trip_invite(p_member, p_trip, p_action, p_actor) → { outcome }.
    // outcome: accepted | declined | owner_stray — afterWrite решает mark-read+emit.
    respond: {
      op: 'rpc',
      rpc: 'respond_trip_invite',
      table: 'trip_members',
      requires: [],
      loadTarget: true,
      fields: { action: { type: 'string', required: true, enum: ['accept', 'decline'] } },
      buildArgs: (values, ctx) => ({ p_member: ctx.targetId, p_trip: ctx.scopeValue, p_action: values.action }),
      // Владение инвайтом: по user_id ЛИБО по email (обе ветки — принцип №0).
      // Затем состояние: отвечать можно только на висящее приглашение.
      guardRow: (row, actor) => {
        const ownsById = !!row.user_id && row.user_id === actor.id;
        const ownsByEmail = !!row.invite_email && !!actor.email &&
          String(row.invite_email).toLowerCase() === actor.email.toLowerCase();
        if (!ownsById && !ownsByEmail) return forbid(403, 'FORBIDDEN', 'This invite is not yours');
        if (row.status !== 'pending') return forbid(409, 'ALREADY_RESPONDED', 'Invite already responded to');
        return null;
      },
    },
  },
};
