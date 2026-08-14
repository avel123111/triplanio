/**
 * Ресурс `trip-share` — шеринг и копия трипа за единой дверью (TRIP-416, блок 3
 * эпика TRIP-374). Ось авторизации ОДНА: `requires:['participant']` — зритель
 * ПРОХОДИТ осознанно: публичная ссылка открывает то, что участник и так видит
 * (TRIP-202), а копия создаётся как СВОЙ трип копирующего (лимит бьёт триггер).
 *
 * Оба действия — `op:'rpc'` (>1 обращения / атомарная транзакция, не пустая
 * обёртка — TRIP-405). Скоуп (`p_trip`/`p_source` из проверенного скоупа +
 * `p_actor` от шва) вшит в тело RPC → IDOR закрыт по-действию (тест). Файл
 * import-free (кроме типов) — пинится тестом без загрузки клиента БД.
 */

import { TRIP_LIMIT_REACHED } from '../mutateRules.ts';
import type { ResourceSpec } from '../mutateRules.ts';

export const TRIP_SHARE: ResourceSpec = {
  name: 'trip-share',
  scope: { column: 'id', from: 'tripId' },
  actions: {
    // ── Публичная ссылка: find-or-create токена ───────────────────────────────
    // ensure_trip_share_token(p_trip, p_actor) → { shareToken }.
    share: {
      op: 'rpc',
      rpc: 'ensure_trip_share_token',
      requires: ['participant'],
      buildArgs: (_values, ctx) => ({ p_trip: ctx.scopeValue }),
    },

    // ── Копия трипа: вся копия ОДНОЙ атомарной транзакцией ─────────────────────
    // copy_trip(p_source, p_actor) → { outcome, tripId? }.
    // outcome: ok (успех, tripId) | limit (лимит free/Pro) | not_found (гонка).
    copy: {
      op: 'rpc',
      rpc: 'copy_trip',
      requires: ['participant'],
      buildArgs: (_values, ctx) => ({ p_source: ctx.scopeValue }),
      mapOutcome: (data) => {
        const d = data as { outcome?: string; tripId?: string } | null;
        // Лимит free/Pro — честный 402, ЕДИНЫЙ литерал с trip_quota-веткой шва.
        if (d?.outcome === 'limit') return TRIP_LIMIT_REACHED;
        // Source исчез между гейтом и RPC (гонка) — participant-гейт обычно ловит раньше.
        if (d?.outcome === 'not_found') return { status: 404, code: 'NOT_FOUND', message: 'Not found' };
        return { data: { tripId: d?.tripId } };
      },
    },
  },
};
