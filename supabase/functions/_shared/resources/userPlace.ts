/**
 * Ресурс `user-place` — домен статистики (TRIP-402, эпик TRIP-374, блок 3).
 *
 * Запись `user_custom_visits` — ручные визиты на карте «Моя статистика». Заменяет
 * 3 прямых `from('user_custom_visits')` фронта (`AddPlaceDialog`): insert / update
 * по id / delete по id. Спецификация — ДАННЫЕ: шов (`../mutate.ts`) исполняет её
 * тем же кодом, что `account`/`trip-budget`/`trip-document`, без единой правки
 * (приёмка блока 2). Файл import-free (кроме типов), как соседи.
 *
 * ★ ПЕРВЫЙ ресурс, где scope-колонка ≠ target id. Владение — актором
 * (`scope.from:'actor'`), но колонка скоупа `user_id`, а адресуется строка своим
 * `id` (bigint identity). `buildPlan` это УЖЕ умеет и закрывает IDOR по
 * построению: на insert инъектит `{ user_id: actor }` из scope, на update/delete
 * матчит `{ id, user_id: actor }`. Поэтому `forcedOnInsert` НЕ объявляем —
 * `user_id` ставит сам scope; дублировать было бы зоопарком. `guardRow` не нужен:
 * правила по СОСТОЯНИЮ строки нет, владение целиком закрывает scope.
 *
 * ★★ `requires:['self']` — при `scope.from:'actor'` скоуп всегда равен актору, право
 * тривиально; объявлено ЯВНО как маркер «строкой владеет актор» (тот же слот, что
 * `editor` у трип-ресурсов), шов вычисляет его одинаково.
 *
 * Поля ниже — зеркало живой схемы (dev 2026-08-11): всё nullable, обязательных
 * НЕТ (как в текущей таблице). Единственный CHECK — `country_code ≤ 8` (кэп max).
 * `name_i18n` — jsonb-ОБЪЕКТ (map «локаль→имя»), поэтому `type:'json'` (не 'array':
 * массив молча прошёл бы и сломал форму). Расходиться с CHECK нельзя: что БД
 * отвергнет как 500, шов обязан отвергнуть внятным 400.
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const USER_PLACE: ResourceSpec = {
  name: 'user-place',
  scope: { column: 'user_id', from: 'actor' },
  actions: {
    /** Добавить/править свой ручной визит: upsert по id, user_id ставит scope. */
    place: {
      op: 'upsert',
      table: 'user_custom_visits',
      requires: ['self'],
      fields: {
        geonameid: { type: 'number', nullable: true },
        name_i18n: { type: 'json', nullable: true },
        country_code: { type: 'string', max: 8, nullable: true },
        lat: { type: 'number', nullable: true },
        lng: { type: 'number', nullable: true },
        start_date: { type: 'date', nullable: true },
        end_date: { type: 'date', nullable: true },
      },
    },

    'place/delete': {
      op: 'delete',
      table: 'user_custom_visits',
      requires: ['self'],
    },
  },
};
