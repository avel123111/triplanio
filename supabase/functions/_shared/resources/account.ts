/**
 * Ресурс `account` — ПЕРВЫЙ домен блока 3 за единой дверью (TRIP-400, эпик TRIP-374).
 *
 * Первый self-ресурс записи: владение — не трипом, а самим актором
 * (`scope.from:'actor'`). Спецификация — ДАННЫЕ: шов (`../mutate.ts`) исполняет её
 * тем же кодом, что `trip-budget`/`trip-document`, без единой правки. Файл
 * import-free (кроме типов) по той же причине, что `../mutateRules.ts`, — правило
 * пинится тестом без загрузки клиента БД.
 *
 * ★ КОНТРАКТ. Заменяет 5 прямых `from('users').update(...)` фронта одной дверью:
 *   профиль (имя+аватар)   ScreenAccount.handleSave
 *   аватар после загрузки  ScreenAccount.handleAvatarUpload
 *   сброс аватара          ScreenAccount.handleRemoveAvatar (avatar_url=null)
 *   язык                   I18nContext.setLang
 *   единицы                I18nContext.setUnits
 * Все они — ЧАСТИЧНЫЙ upsert своей строки: `op:'upsert'` + `targetBy:'scope'` даёт
 * чистый update по `{ id: actor }` (строка уже создана на регистрации; вставка
 * профиля — домен регистрации, не здесь). Присланный id игнорируется.
 *
 * ★★ `requires:['self']` — при `scope.from:'actor'` скоуп всегда равен актору,
 * поэтому право тривиально выполнено; объявлено ЯВНО как маркер «строкой владеет
 * актор» (тот же слот, что `editor` у трип-ресурсов) — шов вычисляет его
 * одинаково, без `if` по имени ресурса.
 *
 * Кэпы/enum ниже — зеркало CHECK живой схемы (сверено live dev 2026-08-10):
 *   full_name    ≤300, nullable
 *   avatar_url   ≤2048, nullable
 *   language     ∈{ru,en,es}, nullable
 *   unit_system  ∈{metric,imperial}, NOT NULL — поэтому БЕЗ `nullable`: `null`
 *                отобьётся внятным 400 в шве, а не сырым 500 от DB NOT NULL.
 * Расходиться с CHECK нельзя: что БД отвергнет как 500 с текстом Postgres, шов
 * обязан отвергнуть как внятный 400.
 */

import type { ResourceSpec } from '../mutateRules.ts';

export const ACCOUNT: ResourceSpec = {
  name: 'account',
  scope: { column: 'id', from: 'actor' },
  actions: {
    /** Профиль/настройки своей строки users: частичный upsert по скоупу-актору. */
    profile: {
      op: 'upsert',
      table: 'users',
      requires: ['self'],
      targetBy: 'scope',
      fields: {
        full_name: { type: 'string', max: 300, nullable: true },
        avatar_url: { type: 'string', max: 2048, nullable: true },
        language: { type: 'string', enum: ['ru', 'en', 'es'], nullable: true },
        // NOT NULL в БД → `null` не пропускаем (внятный 400, не сырой 500).
        unit_system: { type: 'string', enum: ['metric', 'imperial'] },
      },
    },
  },
};
