/**
 * Identity-колонки строки `city_visits` — ОДИН фрагмент на три потребителя
 * (TRIP-406, домен маршрута эпика TRIP-374). Живут здесь, а не расписаны трижды:
 *   • booking  — waypoint-города сложного переезда (`tripBooking.WAYPOINT`);
 *   • route    — payload `city/add` (`tripRoute`);
 *   • trip     — каждый город при создании (`trip.create`).
 * `kind`/`nights` — надстройка per-action (маршрут/создание добавляют их сверху),
 * поэтому НЕ входят в общий фрагмент: это идентичность города, а не его роль в
 * конкретной цепочке.
 *
 * Кэпы — зеркало CHECK живой схемы (сверено live dev 2026-08-12), как и в
 * соседних спецификациях: что БД отвергнет 500-текстом Postgres, шов обязан
 * отвергнуть внятным 400. Файл import-free (кроме типа) — правило пинится тестом
 * без загрузки клиента БД (та же конвенция, что `../mutateRules.ts`).
 */

import type { FieldSpec } from '../mutateRules.ts';

/** Числовая координата (широта/долгота): клиент шлёт число или null. */
const coord = (): FieldSpec => ({ type: 'number', nullable: true });

export const CITY_FIELDS: Record<string, FieldSpec> = {
  external_city_id: { type: 'string', max: 300, nullable: true },
  geonameid: { type: 'number', nullable: true },
  name_i18n: { type: 'json', nullable: true },
  city_name_en: { type: 'string', max: 300, nullable: true },
  country_code: { type: 'string', max: 8, nullable: true },
  latitude: coord(),
  longitude: coord(),
  timezone: { type: 'string', max: 300, nullable: true },
};

/**
 * Роль города в цепочке (`city_visits.kind`) — надстройка над identity, поэтому ВНЕ
 * `CITY_FIELDS` (это не идентичность), но общая для route (add) и create → один
 * enum-источник против CHECK `city_visits_kind_check`, а не две копии.
 */
export const KIND_FIELD: FieldSpec = {
  type: 'string',
  enum: ['transit', 'start', 'end', 'waypoint'],
  nullable: true,
};
