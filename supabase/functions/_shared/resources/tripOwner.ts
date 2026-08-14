/**
 * Ресурс `trip-owner` — действия, которые может ТОЛЬКО владелец трипа (TRIP-416,
 * блок 3 эпика TRIP-374). Ось авторизации ОДНА: `requires:['owner']` — верхняя
 * ступень лестницы `tripAccess` (`trips.created_by === actor`), реализованная
 * одной строкой в `_shared/mutate.ts#checkRequirement` (механизм эпика «новое
 * требование = одна строка», как `participant` в TRIP-408). Отдельный ресурс от
 * `trip-settings` (editor) — правило однородного `requires` по ресурсу.
 *
 * `delete` = `op:'delete'` по СКОУПУ (`targetBy:'scope'`, генерик-ветка
 * `buildPlan`, симметричная upsert-by-scope): удаляется сам трип (`trips` по `id`),
 * клиент шлёт только `{ tripId }`, никакого row-id. Дочерние строки — ON DELETE
 * CASCADE; `purchase`/`partner_clicks`/`trip_subscriptions` — SET NULL (учёт).
 * Внешняя побочка (Telegram-teardown + Storage-purge) — best-effort `afterWrite`
 * (`mutateEffects.ts`): FK каскад сам снимает строки привязок Telegram, teardown
 * оставлен forward-домом под будущий Telegram-API-шаг.
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const TRIP_OWNER: ResourceSpec = {
  name: 'trip-owner',
  scope: { column: 'id', from: 'tripId' },
  actions: {
    delete: {
      op: 'delete',
      table: 'trips',
      targetBy: 'scope',
      requires: ['owner'],
    },
  },
};
