/**
 * Ресурс `trip-member` — управление участниками трипа за единой дверью
 * (TRIP-409, блок 3 эпика TRIP-374). Ось авторизации ОДНА и однородная:
 * `requires:['editor']` (создатель или активный админ) — поэтому все действия,
 * гейтящиеся ролью, живут здесь; row-self-действия (`leave`/`respond`) вынесены
 * в отдельный ресурс `trip-member-self` (`requires:[]`), чтобы каждый ресурс был
 * однороден по гейту (правило эпика «запись ПО РЕСУРСУ», как сплит trip/trip-route).
 *
 * Логика (роль/актор/кэпы/ошибки/диспатч) — ОБЩАЯ в шве (`../mutate.ts`);
 * отличается только имя RPC + маппинг аргументов/исхода. Файл import-free (кроме
 * типов) — правило пинится тестом без загрузки клиента БД. Побочки (emit/teardown)
 * — в `tripMemberEffects.ts` (I/O), зовёт их шов через `afterWrite`.
 *
 * ★ IDOR у `op:'rpc'` НЕ автоматический (реестровый sweep-тест строит план и
 * проверяет скоуп только у update/delete). Скоуп вшивается В ТЕЛО RPC (`p_trip`
 * из проверенного скоупа + `p_actor` от шва, как chat/route) и тестируется
 * ПО-ДЕЙСТВУ. `role` — единственный generic `update` здесь, его скоуп реестр
 * проверяет автоматически.
 *
 * ★★ invite = `op:'rpc'`: адресуется по email, делает find-or-reactivate одной
 * транзакцией. Три бизнес-отказа (already_member 409 / self 400 / owner 400) —
 * через `mapOutcome` (дискриминант `data.outcome` → Refusal), НЕ через
 * `unique_violation` (он дал бы 500 через `unwrapDbResult`). Успех = `data.member`.
 */

import type { ResourceSpec } from '../mutateRules.ts';
import { forbid } from '../mutateRules.ts';

/** Роли, которые клиент вправе назначить (owner выдаётся только через created_by). */
const ROLE_FIELD = { type: 'string', required: true, enum: ['viewer', 'admin'] } as const;

export const TRIP_MEMBER: ResourceSpec = {
  name: 'trip-member',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // ── Пригласить по email ───────────────────────────────────────────────────
    // invite_trip_member(p_trip, p_email, p_role, p_actor) → { outcome, member }.
    // outcome: created | reactivated (успех) | already_member | self | owner (отказ).
    invite: {
      op: 'rpc',
      rpc: 'invite_trip_member',
      requires: ['editor'],
      fields: {
        email: { type: 'string', required: true, max: 320 },
        role: ROLE_FIELD,
      },
      buildArgs: (values, ctx) => ({ p_trip: ctx.scopeValue, p_email: values.email, p_role: values.role }),
      mapOutcome: (data) => {
        const outcome = (data as { outcome?: string } | null)?.outcome;
        // Бизнес-«нет» — это ЗНАЧЕНИЕ data.outcome, не ошибка БД.
        if (outcome === 'already_member') {
          return forbid(409, 'ALREADY_MEMBER', 'This user is already invited or a member');
        }
        if (outcome === 'self') return forbid(400, 'INVITE_SELF', 'You cannot invite yourself');
        // `INVITE_OWNER` — контракт фронта (`MembersLens.jsx` → `classifyError`).
        if (outcome === 'owner') return forbid(400, 'INVITE_OWNER', 'Cannot invite the trip owner');
        return { data: (data as { member?: unknown }).member };
      },
    },

    // ── Добавить офлайн-участника (имя без аккаунта) ───────────────────────────
    'add-offline': {
      op: 'insert',
      table: 'trip_members',
      requires: ['editor'],
      // Клиент шлёт имя прямо в колонку `user_full_name` (денорм — принцип №0
      // сохраняет запись). Непустоту форсит `validate` (как раньше `name.trim()`).
      fields: {
        user_full_name: {
          type: 'string',
          required: true,
          max: 300,
          validate: (v) =>
            typeof v === 'string' && v.trim()
              ? null
              : forbid(400, 'INVALID_INPUT', 'Name is required'),
        },
      },
      // Серверные колонки offline-строки: аккаунта/приглашения нет, статус offline.
      forcedOnInsert: {
        user_id: null,
        invite_email: null,
        role: 'viewer',
        status: 'offline',
        invited_by: '@actor',
        created_by: '@actor',
      },
    },

    // ── Переслать ещё раз (только re-emit, записи НЕТ) ─────────────────────────
    resend: {
      op: 'none',
      table: 'trip_members',
      requires: ['editor'],
      loadTarget: true,
      // Пересылать можно только висящее приглашение; иначе 400 (как сегодня).
      guardRow: (row) =>
        row.status === 'pending' ? null : forbid(400, 'NOT_PENDING', 'Invitation is not pending'),
    },

    // ── Сменить роль участника ────────────────────────────────────────────────
    // `upsert` = UPDATE по id (движок не имеет отдельного update-only op); клиент
    // всегда шлёт id → всегда UPDATE. Скоуп этой ветки реестровый sweep-тест
    // проверяет автоматически (единственный generic update домена).
    role: {
      op: 'upsert',
      table: 'trip_members',
      requires: ['editor'],
      loadTarget: true,
      fields: { role: ROLE_FIELD },
      // Роль владельца неизменна (owner = trips.created_by, а не строка членства).
      guardRow: (row) =>
        row.role === 'owner' ? forbid(400, 'OWNER_IMMUTABLE', 'Cannot change owner role') : null,
    },

    // ── Удалить участника (delete + опциональный бан АТОМАРНО в RPC) ───────────
    // remove_trip_member(p_member, p_trip, p_actor, p_block): DELETE строки +
    // (если p_block) INSERT блока (только при user_id). Бан — ЯВНОЕ намерение
    // админа («Удалить и заблокировать»), не побочка: обычное «Удалить» и «Отменить
    // приглашение» шлют block=false и бан не пишут (TRIP-412). loadTarget+table —
    // чтобы afterWrite получил loadedRow (user_id/trip_id для teardown). Бан пишется
    // в RPC, НЕ в afterWrite: security-контроль (rule #13), best-effort проглотил бы сбой.
    remove: {
      op: 'rpc',
      rpc: 'remove_trip_member',
      table: 'trip_members',
      requires: ['editor'],
      loadTarget: true,
      // `block` опционален (умолчание false в RPC): true только для «Удалить и
      // заблокировать» с фронта. Валидатор держит тип строго (не коэрция '1'/1).
      fields: { block: { type: 'boolean' } },
      buildArgs: (values, ctx) => ({
        p_member: ctx.targetId,
        p_trip: ctx.scopeValue,
        p_block: values.block === true,
      }),
      // Владельца не удалить; себя — через `trip-member-self/leave`, не здесь.
      guardRow: (row, actor) => {
        if (row.role === 'owner') return forbid(400, 'OWNER_IMMUTABLE', 'Cannot remove owner');
        if (row.user_id === actor.id) return forbid(400, 'REMOVE_SELF', 'Use leave to remove yourself');
        return null;
      },
    },

    // ── Разблокировать (снять бан) ────────────────────────────────────────────
    // unblock_trip_member(p_trip, p_user, p_actor): DELETE строки блок-листа.
    // Адресуется по user_id (у забаненного строки членства нет — targetId/id тут не
    // при чём), поэтому НЕ loadTarget: цель не в trip_members. Скоуп p_trip вшит в
    // тело RPC (IDOR, тест по-действию). Разбан ≠ восстановление членства.
    unblock: {
      op: 'rpc',
      rpc: 'unblock_trip_member',
      requires: ['editor'],
      fields: { user_id: { type: 'uuid', required: true } },
      buildArgs: (values, ctx) => ({ p_trip: ctx.scopeValue, p_user: values.user_id }),
    },
  },
};
