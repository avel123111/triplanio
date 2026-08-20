/**
 * Ресурс `trip-settings` — настройки трипа за единой дверью (TRIP-416, блок 3
 * эпика TRIP-374). Ось авторизации ОДНА: `requires:['editor']` (создатель или
 * активный админ) — тот же гейт, что члены/ссылки/бюджет-настройки.
 *
 * `settings` = `op:'rpc'` `update_trip_settings` (read-modify-write jsonb деталей
 * + условный Pro-отказ = НЕ плоский update, обёртка не пустая — TRIP-405). Верхние
 * колонки (title≤300/description/cover_image_url/notes) валидирует вложенный
 * `fields`-объект тем же движком `validateFields` (не копия правил);
 * патч деталей — `main_currency`/`display`/`addons` (`type:'json'`). Тело фронта
 * почти прежнее — шов берёт scope из `body.tripId`.
 *
 * Pro-гейт (включаешь Pro-аддон на не-Pro трипе) живёт В ТЕЛЕ RPC (`is_trip_pro`
 * + `is_pro_addon`) и приезжает дискриминантом `outcome:'pro_required'` →
 * `mapOutcome` переводит в канон `PRO_REQUIRED` (402). Файл import-free (кроме
 * чистого `mutateRules.ts`) — правило пинится тестом без загрузки клиента БД.
 */

import { PRO_REQUIRED, validateFields } from '../mutateRules.ts';
import type { FieldSpec, Refusal, ResourceSpec } from '../mutateRules.ts';

/**
 * Верхние колонки `trips`, которые клиент вправе менять. Кэп title≤300 = зеркало
 * CHECK `trips_title_len` (иначе нарушение вернулось бы сырым 500). Семантика
 * ЧАСТИЧНОГО обновления (`insert:false`): отсутствующий ключ не трогает колонку,
 * `null` обнуляет nullable-колонку.
 */
const SETTINGS_COL_FIELDS: Record<string, FieldSpec> = {
  title: { type: 'string', max: 300 },
  description: { type: 'string', nullable: true },
  cover_image_url: { type: 'string', nullable: true },
  notes: { type: 'string', nullable: true },
};

/**
 * Валидатор вложенного `fields`-объекта: прогоняет его ТЕМ ЖЕ `validateFields`
 * (партиал-семантика), что и одиночная запись, — не копия правил (TRIP-405).
 * `type:'json'` уже гарантировал, что это не-массивный объект.
 */
function validateSettingsFields(value: unknown): Refusal | null {
  const r = validateFields(SETTINGS_COL_FIELDS, value as Record<string, unknown>, { insert: false });
  return 'status' in r ? r : null;
}

export const TRIP_SETTINGS: ResourceSpec = {
  name: 'trip-settings',
  scope: { column: 'id', from: 'tripId' },
  actions: {
    // update_trip_settings(p_trip, p_actor, p_fields, p_details_patch) → { outcome }.
    settings: {
      op: 'rpc',
      rpc: 'update_trip_settings',
      requires: ['editor'],
      fields: {
        // Верхние колонки — вложенным объектом (валидируется хуком выше).
        fields: { type: 'json', validate: validateSettingsFields },
        // Патч деталей: плоские ключи тела, каждый по своему типу.
        main_currency: { type: 'string', max: 8 },
        display: { type: 'json' },
        addons: { type: 'json' },
      },
      buildArgs: (values, ctx) => {
        const patch: Record<string, unknown> = {};
        // Пустую валюту не пишем (зеркалит оригинальный `typeof === 'string' && main_currency`).
        if (values.main_currency) patch.main_currency = values.main_currency;
        if (values.display !== undefined) patch.display = values.display;
        if (values.addons !== undefined) patch.addons = values.addons;
        return { p_trip: ctx.scopeValue, p_fields: values.fields ?? {}, p_details_patch: patch };
      },
      // Бизнес-«нет» = ЗНАЧЕНИЕ outcome, не ошибка БД. Канон PRO_REQUIRED (402+skip)
      // — тот же литерал, что дверь proRefusal (единый источник, mutateRules.ts).
      // Успех = `{ data: null }`, как любое другое действие шва: дискриминант
      // успеха/отказа живёт в КОРНЕ ответа (error/code), НЕ флагом в data (TRIP-400).
      // Искусственный `{ ok: true }` фабриковал бы «флаг успеха в data» — ровно тот
      // анти-паттерн, что ловит гард 2w.
      mapOutcome: (data) => {
        const outcome = (data as { outcome?: string } | null)?.outcome;
        if (outcome === 'pro_required') return PRO_REQUIRED;
        return { data: null };
      },
    },
  },
};
