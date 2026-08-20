/**
 * Ресурс `trip-booking` — ЧЕТВЁРТЫЙ домен за единой дверью (TRIP-405, эпик TRIP-374).
 *
 * ОДИН писатель на 4 booking-таблицы (`hotel_stays`/`transfers`/`activities`/
 * `trip_services`). Логика (роль/актор/кэпы/ошибки/диспатч) — ОБЩАЯ в шве
 * (`../mutate.ts`); отличаются только КОЛОНКИ (данные), потому что таблицы разные.
 * Файл import-free (кроме типов + `validateFields`) по той же причине, что и
 * `../mutateRules.ts`: правило пинится тестом без загрузки клиента БД.
 *
 * ★ АНТИ-ДУБЛЬ НА УРОВНЕ ДАННЫХ. Общие колонки живут в ОДНОМ фрагменте
 * `COMMON_BOOKING_FIELDS`, спредятся в каждый вид; сверху — вид-специфика.
 * `TRANSFER_FIELDS` — колонки переезда, ОБЩИЕ для простого `transfer` И
 * per-segment валидации `transfer-layover` (не копия): сегмент layover — это тот
 * же transfer без города-концов (их ставит RPC по цепочке waypoints). Логика не
 * форкается ни разу; разное только данные.
 *
 * ★★ ПОЧЕМУ `upsert` (правка by id) здесь безопасна, в отличие от `trip-document`
 * (create-only): у броней право = РОЛЬ (`editor`), не автор строки; построчного
 * правила нет → `guardRow` не нужен. `update` матчится `{id, trip_id}` (скоуп
 * трипа) → редактор чужой трип не тронет (IDOR закрыт построителем плана).
 *
 * ★★★ ПОЧЕМУ layover — `op:'rpc'`, а не 4-я upsert-ветка. Сложный переезд пишет
 * >1 строки в ОДНОЙ транзакции (N-1 waypoint-городов + N сегментов + recompute):
 * это по определению `op:'rpc'` (`add_layover_transfer`). `p_actor` инъектит шов,
 * `created_by` строк ставит сама RPC = `p_actor`; клиент актора не называет.
 *
 * ☞ Уведомление «бронь добавлена»: эмитит шов через `AFTER_WRITE` (`mutateEffects.ts`,
 * событие `booking_added`) для всех 4 видов + сложного переезда — как invite/member.
 * Немой PG-триггер `notify_booking_added` снесён (TRIP-284): он не уведомлял активности
 * и глушил сбой в `raise warning` мимо Sentry.
 *
 * Кэпы/энумы ниже — ЗЕРКАЛО CHECK живой схемы (baseline + замер dev 2026-08-12).
 * Расходиться нельзя: что БД отвергнет как 500 с текстом Postgres, шов обязан
 * отвергнуть как внятный 400. `booking_url ~ ^https?://` (антивзлом TRIP-281) и
 * `documents[].file_url` невыразимы `type/max/enum` → едут `validate`-хуком.
 */

import { bad, HTTP_URL, validateDocuments, validateEach } from '../mutateRules.ts';
import type { FieldSpec, Refusal, ResourceSpec } from '../mutateRules.ts';
import { CITY_FIELDS, coord } from './cityFields.ts';

const httpUrl = (v: unknown): Refusal | null =>
  typeof v === 'string' && HTTP_URL.test(v) ? null : bad('booking_url must be an http(s) URL');

/**
 * `details` услуги (`trip_services`) — jsonb-ОБЪЕКТ, где живут documents/notes/
 * booking_* (у услуги нет верхних колонок под них). CHECK `ts_documents_urls`
 * стоит на `details`, path `$.documents[*].file_url` → зеркалим только этот
 * инвариант; остальную форму `details` БД не ограничивает.
 */
function validateServiceDetails(value: unknown): Refusal | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad('Field "details" must be an object');
  }
  const docs = (value as { documents?: unknown }).documents;
  if (docs === undefined || docs === null) return null;
  return validateDocuments(docs);
}

/** timestamptz-колонка: клиент шлёт ISO-строку или null. Кривой момент → 400, не 500 БД. */
const ts = (): FieldSpec => ({
  type: 'string',
  max: 40,
  nullable: true,
  validate: (v) =>
    typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? null : bad('must be an ISO datetime'),
});

/** Деньги — общий фрагмент всех 4 видов. `currency` NOT NULL (клиент всегда шлёт). */
const MONEY_FIELDS: Record<string, FieldSpec> = {
  price: { type: 'number', min: 0, nullable: true },
  currency: { type: 'string', max: 8, required: true },
};

/**
 * Ссылка + референс брони — ВЕРХНИЕ колонки. Есть у `hotel_stays`/`transfers`
 * (и у сегмента layover — сегмент это transfer), но НЕ у `activities`: у таблицы
 * активности этих колонок нет вовсе. Спред этих полей в `activity` = 500 с сырым
 * текстом Postgres (`42703 undefined_column`), а не внятный 400 (TRIP-420); у
 * активности booking-ссылка живёт внутри `details` (jsonb), как у `service`.
 */
const BOOKING_REF_FIELDS: Record<string, FieldSpec> = {
  booking_reference: { type: 'string', max: 300, nullable: true },
  booking_url: { type: 'string', max: 2048, nullable: true, validate: httpUrl },
};

/** Файлы + заметки — верхние колонки, ОБЩИЕ для hotel/transfer/activity. */
const DOCS_NOTES_FIELDS: Record<string, FieldSpec> = {
  documents: { type: 'array', nullable: true, validate: validateDocuments },
  notes: { type: 'string', max: 10000, nullable: true },
};

/** Мета брони целиком: ссылка + референс + файлы + заметки. Для hotel/transfer И сегмента layover. */
const BOOKING_META_FIELDS: Record<string, FieldSpec> = {
  ...BOOKING_REF_FIELDS,
  ...DOCS_NOTES_FIELDS,
};

/**
 * Общие ВЕРХНИЕ колонки hotel/transfer. `activity` НЕ входит (у `activities` нет
 * booking_reference/booking_url — см. BOOKING_REF_FIELDS), а у `service` верхних
 * колонок брони нет вовсе (всё в `details`, см. SERVICE ниже).
 */
const COMMON_BOOKING_FIELDS: Record<string, FieldSpec> = {
  ...MONEY_FIELDS,
  ...BOOKING_META_FIELDS,
  details: { type: 'json', nullable: true },
};

/**
 * Колонки переезда — общие для простого `transfer` И каждого сегмента layover
 * (city-концы и `created_by` сегмента ставит RPC, поэтому здесь их НЕТ).
 */
const TRANSFER_FIELDS: Record<string, FieldSpec> = {
  transport_type: {
    type: 'string',
    enum: ['plane', 'train', 'bus', 'car', 'taxi', 'ferry', 'walk', 'own_transport', 'other'],
  },
  day_change: { type: 'boolean' },
  start_datetime: ts(),
  end_datetime: ts(),
  carrier: { type: 'string', max: 300, nullable: true },
  flight_number: { type: 'string', max: 300, nullable: true },
  from_address: { type: 'string', max: 10000, nullable: true },
  to_address: { type: 'string', max: 10000, nullable: true },
  from_latitude: coord(),
  from_longitude: coord(),
  to_latitude: coord(),
  to_longitude: coord(),
};

/** Один сегмент layover = transfer без city-концов + общие деньги/бронь/доки. */
const SEGMENT_FIELDS: Record<string, FieldSpec> = {
  ...MONEY_FIELDS,
  ...BOOKING_META_FIELDS,
  ...TRANSFER_FIELDS,
};

/**
 * Промежуточный город-пересадка (RPC пишет его строкой `city_visits kind='waypoint'`).
 * Это ТЕ ЖЕ identity-колонки, что у route/create → общий фрагмент `CITY_FIELDS`
 * (анти-дубль на уровне данных, TRIP-406), а не третья копия описания.
 */
const WAYPOINT_FIELDS = CITY_FIELDS;

export const TRIP_BOOKING: ResourceSpec = {
  name: 'trip-booking',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    // ── Отель ────────────────────────────────────────────────────────────────
    hotel: {
      op: 'upsert',
      table: 'hotel_stays',
      requires: ['editor'],
      fields: {
        ...COMMON_BOOKING_FIELDS,
        city_visit_id: { type: 'uuid', required: true },
        name: { type: 'string', required: true, max: 300 },
        address: { type: 'string', max: 10000, nullable: true },
        latitude: coord(),
        longitude: coord(),
        check_in_datetime: ts(),
        check_out_datetime: ts(),
        payment_status: { type: 'string', enum: ['paid', 'partial', 'pay_on_arrival'], nullable: true },
        free_cancellation: { type: 'boolean' },
        free_cancellation_until: ts(),
        phone: { type: 'string', max: 300, nullable: true },
        email: { type: 'string', max: 320, nullable: true },
      },
      forcedOnInsert: { created_by: '@actor' },
    },
    'hotel/delete': { op: 'delete', table: 'hotel_stays', requires: ['editor'], loadTarget: true },

    // ── Переезд (простой) ─────────────────────────────────────────────────────
    // `returnChain`: запись переезда двигает даты городов через `day_change`
    // (триггер `trg_recompute_transfer`). Шов дочитывает пересчитанную цепочку и
    // отдаёт `{ row, cities }` — клиент реконсилит даты из одного ответа.
    transfer: {
      op: 'upsert',
      table: 'transfers',
      requires: ['editor'],
      returnChain: true,
      fields: {
        ...COMMON_BOOKING_FIELDS,
        from_city_visit_id: { type: 'uuid', nullable: true },
        to_city_visit_id: { type: 'uuid', nullable: true },
        ...TRANSFER_FIELDS,
      },
      forcedOnInsert: { created_by: '@actor' },
    },
    'transfer/delete': { op: 'delete', table: 'transfers', requires: ['editor'], loadTarget: true, returnChain: true },

    // ── Активность ────────────────────────────────────────────────────────────
    // У `activities` НЕТ верхних booking_reference/booking_url — поэтому активность
    // НЕ спредит COMMON_BOOKING_FIELDS (аутлаер среди броней): деньги + файлы/
    // заметки + `details`, куда клиент кладёт booking-ссылку (как `service`).
    activity: {
      op: 'upsert',
      table: 'activities',
      requires: ['editor'],
      fields: {
        ...MONEY_FIELDS,
        ...DOCS_NOTES_FIELDS,
        details: { type: 'json', nullable: true },
        city_visit_id: { type: 'uuid', required: true },
        title: { type: 'string', required: true, max: 300 },
        start_datetime: ts(),
        end_datetime: ts(),
        location_address: { type: 'string', max: 10000, nullable: true },
        location_latitude: coord(),
        location_longitude: coord(),
      },
      forcedOnInsert: { created_by: '@actor' },
    },
    'activity/delete': { op: 'delete', table: 'activities', requires: ['editor'], loadTarget: true },

    // ── Услуга (eSIM / аренда авто / страховка) ───────────────────────────────
    // У услуги нет верхних колонок под бронь/доки: всё в `details` (jsonb).
    service: {
      op: 'upsert',
      table: 'trip_services',
      requires: ['editor'],
      fields: {
        ...MONEY_FIELDS,
        kind: { type: 'string', enum: ['esim', 'car_rental', 'insurance'], nullable: true },
        name: { type: 'string', required: true, max: 300 },
        pickup_datetime: ts(),
        dropoff_datetime: ts(),
        details: { type: 'json', nullable: true, validate: validateServiceDetails },
      },
      forcedOnInsert: { created_by: '@actor' },
    },
    'service/delete': { op: 'delete', table: 'trip_services', requires: ['editor'], loadTarget: true },

    // ── Сложный переезд с пересадками (транзакция) ────────────────────────────
    // >1 записи в БД в одной транзакции → op:'rpc' (правило TRIP-405). Per-segment
    // и per-waypoint валидация — ТЕМ ЖЕ `validateFields`, что одиночная запись.
    'transfer-layover': {
      op: 'rpc',
      rpc: 'add_layover_transfer',
      requires: ['editor'],
      returnChain: true,
      fields: {
        from_city_visit_id: { type: 'uuid', required: true },
        to_city_visit_id: { type: 'uuid', required: true },
        waypoints: { type: 'array', required: true, validate: validateEach(WAYPOINT_FIELDS, 'waypoints') },
        segments: { type: 'array', required: true, validate: validateEach(SEGMENT_FIELDS, 'segments') },
      },
      // Чистый маппинг в аргументы RPC; `p_actor` инъектит шов (buildPlan).
      buildArgs: (values, ctx) => ({
        p_trip: ctx.scopeValue,
        p_from: values.from_city_visit_id,
        p_to: values.to_city_visit_id,
        p_waypoints: values.waypoints,
        p_segments: values.segments,
      }),
    },
  },
};
