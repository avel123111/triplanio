/**
 * Ресурс `trip` — создание трипа с маршрутом за единой дверью (TRIP-406, эпик TRIP-374).
 *
 * ОДНО действие `create` = ОДИН атомарный RPC `create_trip_with_route`: INSERT
 * `trips` (created_by=`p_actor`) → bulk INSERT `city_visits` → `recompute_trip`
 * серверным движком дат. Схлопывает прежние ДВА клиентских шага (RPC `create_trip`
 * + прямой `.from('city_visits').insert`) в одну транзакцию: чинит вторую дверь в
 * `city_visits`, не-атомарность (трип-сирота при сбое посева) и клиентскую
 * арифметику дат (`addDays` → сервер). `op:'rpc'` по правилу TRIP-405 (>1 записи).
 *
 * ★ SCOPE=`actor` (тот же примитив, что account/user_place, но с `op:'rpc'`).
 * Владелец — актор из JWT; `created_by` не подделать (его ставит RPC = `p_actor`,
 * инъектит шов). Роли трипа НЕТ — трипа ещё нет; поэтому этот ресурс НЕЛЬЗЯ
 * объединять с `trip-route` (гард P2: все действия seam-ресурса требуют одно и то
 * же, а тут `trip_quota` ≠ `editor`) — сплит осознанный.
 *
 * ★★ `requires:['trip_quota']` — авторитетный гейт лимита free/Pro на ЗАПИСИ:
 * зовёт ТЕ ЖЕ предикаты (`is_user_pro` + `count_active_owned_trips`), что триггер
 * `enforce_trip_limit` и клиентская пред-проверка планнера, → честный 402
 * `TRIP_LIMIT_REACHED`. Три слоя над ОДНИМ предикатом, не три копии. Pro на
 * редактировании маршрута НЕТ (Pro гейтит только AI-парсер) — как в booking.
 *
 * Даты кладёт СЕРВЕР: клиент шлёт `nights` (span) каждого города, не посчитанные
 * даты — паритет с прежним `addDays` структурный (DoD: сверить визуально).
 * Кэпы — зеркало CHECK живой схемы (сверено live dev 2026-08-12): trips.title ≤300.
 */

import { validateEach } from '../mutateRules.ts';
import type { FieldSpec, ResourceSpec } from '../mutateRules.ts';
import { CITY_FIELDS, KIND_FIELD } from './cityFields.ts';

/**
 * Город при создании = identity (`CITY_FIELDS`, общий фрагмент) + роль в цепочке
 * (`KIND_FIELD`, общий с route) + число ночей. Даты НЕ входят: их кладёт
 * `recompute_trip`. `nights` 0..60 клампит RPC; шов держит `>= 0`.
 */
const CREATE_CITY_FIELDS: Record<string, FieldSpec> = {
  ...CITY_FIELDS,
  kind: KIND_FIELD,
  nights: { type: 'number', min: 0, nullable: true },
};

export const TRIP: ResourceSpec = {
  name: 'trip',
  scope: { column: 'created_by', from: 'actor' },
  actions: {
    create: {
      op: 'rpc',
      rpc: 'create_trip_with_route',
      requires: ['trip_quota'],
      fields: {
        title: { type: 'string', required: true, max: 300 },
        startDate: { type: 'date', required: true },
        cities: { type: 'array', required: true, validate: validateEach(CREATE_CITY_FIELDS, 'cities') },
      },
      // Чистый маппинг; `p_actor` (created_by) инъектит шов (buildPlan).
      buildArgs: (values) => ({
        p_title: values.title,
        p_start_date: values.startDate,
        p_cities: values.cities,
      }),
    },
  },
};
