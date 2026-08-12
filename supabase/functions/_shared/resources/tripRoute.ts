/**
 * Ресурс `trip-route` — ПЯТЫЙ домен за единой дверью (TRIP-406, эпик TRIP-374).
 *
 * ОДИН писатель на структуру маршрута (`city_visits`): пять live-edit действий,
 * каждое — атомарный RPC (>1 записи в транзакции: сдвиг позиций / каскад броней /
 * пере-раскладка дат `recompute_trip`), поэтому все `op:'rpc'` по правилу
 * TRIP-405 (пустых обёрток «для симметрии» нет — у каждого действия ≥2 записи).
 * Логика (роль/актор/кэпы/ошибки/диспатч) — ОБЩАЯ в шве (`../mutate.ts`);
 * отличаются только имя RPC + маппинг аргументов. Файл import-free (кроме типов +
 * `CITY_FIELDS`) — правило пинится тестом без загрузки клиента БД.
 *
 * ★ RPC НЕ САМОАВТОРИЗУЮТСЯ (норма эпика, Вариант B устава). Авторизация editor —
 * ЕДИНСТВЕННО в шве (`requires:['editor']` = `isCallerEditor`); внутренний
 * `_can_edit_trip`/`auth.uid()` снят из всех route-RPC миграцией этого PR. RPC
 * получают `p_actor` (его инъектит `buildPlan`, клиент актора не называет):
 * `add_city` кладёт его в `created_by` вставляемого города; остальные принимают
 * его ради единообразия шва, но их запись автора не несёт.
 *
 * ★★ IDOR ЗАКРЫТ ЕДИНЫМ scope=`trip_id`. `remove`/`nights` адресуются id города,
 * но резолвят строку `where id=<город> AND trip_id=<скоуп>` ВНУТРИ RPC — как
 * INTEGRITY («строка принадлежит трипу»), НЕ как авторизация. `op:'rpc'` не
 * матчится построителем плана механически (в отличие от table-DML), поэтому scope
 * едет в тело аргументом `p_trip` из проверенного скоупа шва. «Мой трип + чужой
 * город» → RPC не находит строку → `raise` → NOT_FOUND (осознанно 403→404: гейт
 * editor стоит на p_trip в шве, не на резолве из города).
 *
 * Кэпы/enum ниже — зеркало CHECK живой схемы (сверено live dev 2026-08-12):
 * city_visits.kind ∈ {transit,start,end,waypoint}; identity-колонки — `CITY_FIELDS`
 * (общий фрагмент с booking/create). `nights` 0..60 клампит RPC; шов держит `>= 0`.
 */

import { isUuid } from '../mutateRules.ts';
import type { Refusal, ResourceSpec } from '../mutateRules.ts';
import { CITY_FIELDS, KIND_FIELD } from './cityFields.ts';

const invalid = (message: string): Refusal => ({ status: 400, code: 'INVALID_INPUT', message });

/** `p_order` — массив uuid городов в целевом порядке. Элементы БД примет как
 *  `uuid[]`; кривой элемент → внятный 400, а не сырой 500 от каста Postgres.
 *  UUID-предикат — общий `isUuid` шва (тот же, что `typeOk` для type:'uuid'). */
const uuidArray = (value: unknown): Refusal | null => {
  if (!Array.isArray(value)) return invalid('Field "order" must be a list');
  for (const item of value) {
    if (!isUuid(item)) return invalid('Every order entry must be a city id (uuid)');
  }
  return null;
};

export const TRIP_ROUTE: ResourceSpec = {
  name: 'trip-route',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // ── Добавить город ────────────────────────────────────────────────────────
    // add_city(p_trip, p_city jsonb, p_index, p_actor) → uuid нового city_visit.
    'city/add': {
      op: 'rpc',
      rpc: 'add_city',
      requires: ['editor'],
      fields: {
        ...CITY_FIELDS,
        kind: KIND_FIELD,
        index: { type: 'number', nullable: true },
      },
      // identity+kind собираем в jsonb p_city (RPC читает `p_city->>'...'`);
      // index — отдельный p_index (null = добавить в конец). p_actor — от шва.
      buildArgs: (values, ctx) => {
        const { index, ...city } = values;
        return { p_trip: ctx.scopeValue, p_city: city, p_index: index ?? null };
      },
    },

    // ── Удалить город ─────────────────────────────────────────────────────────
    // remove_city(p_city, p_trip, p_actor): каскад hotels/activities/transfers +
    // DELETE города + recompute. Integrity-scope `trip_id` в теле (raise на 0-match).
    'city/remove': {
      op: 'rpc',
      rpc: 'remove_city',
      requires: ['editor'],
      fields: { cityId: { type: 'uuid', required: true } },
      buildArgs: (values, ctx) => ({ p_city: values.cityId, p_trip: ctx.scopeValue }),
    },

    // ── Переупорядочить города ────────────────────────────────────────────────
    // reorder_cities(p_trip, p_order uuid[], p_actor): UPDATE позиций + recompute.
    'city/reorder': {
      op: 'rpc',
      rpc: 'reorder_cities',
      requires: ['editor'],
      fields: { order: { type: 'array', required: true, validate: uuidArray } },
      buildArgs: (values, ctx) => ({ p_trip: ctx.scopeValue, p_order: values.order }),
    },

    // ── Сменить число ночей города ────────────────────────────────────────────
    // set_city_nights(p_city, p_nights, p_trip, p_actor): UPDATE span + recompute.
    'city/nights': {
      op: 'rpc',
      rpc: 'set_city_nights',
      requires: ['editor'],
      fields: {
        cityId: { type: 'uuid', required: true },
        nights: { type: 'number', required: true, min: 0 },
      },
      buildArgs: (values, ctx) => ({ p_city: values.cityId, p_nights: values.nights, p_trip: ctx.scopeValue }),
    },

    // ── Пере-заякорить старт трипа ────────────────────────────────────────────
    // set_trip_start_date(p_trip, p_date, p_actor): recompute перекладывает даты.
    'start-date': {
      op: 'rpc',
      rpc: 'set_trip_start_date',
      requires: ['editor'],
      fields: { date: { type: 'date', required: true } },
      buildArgs: (values, ctx) => ({ p_trip: ctx.scopeValue, p_date: values.date }),
    },
  },
};
