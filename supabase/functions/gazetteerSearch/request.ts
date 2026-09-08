/**
 * Форма запроса ИНСТРУМЕНТА АГЕНТА к справочнику городов (TRIP-524).
 *
 * ★ ЗАЧЕМ ЭТА ФУНКЦИЯ ВООБЩЕ ЕСТЬ. Пока идентичность города приезжает от модели
 * ТЕКСТОМ, промах возможен всегда — мы лишь двигаем вероятность (жёсткий скоуп
 * по стране, TRIP-159, сдвинул её сильно, но класс жив: в справочнике 622 пары
 * «одно имя, одна страна», и пять Портлендов в США — как раз такая). Инструмент
 * переводит идентичность на КЛЮЧ: агент ищет, ВИДИТ кандидатов вместе с
 * регионом, населением и координатами, выбирает того, кто вяжется с соседями по
 * маршруту, и возвращает `geonameid`. Выбор по контексту нашему резолверу
 * недоступен по построению — он видит одно имя и страну, без маршрута.
 *
 * ★★ ИМЕНА ПОЛЕЙ — ИЗ СЛОВАРЯ МОДЕЛИ, А НЕ ИЗ СЛОВАРЯ БАЗЫ. `city_name`,
 * `city_name_en`, `country_code` — ровно те, которыми модель уже отвечает в
 * операциях (`OPS` в `src/pages/create/aiOps.js`). Правило «одно имя на один
 * смысл» (TRIP-527) здесь несущее: у RPC свои имена (`q`, `q_en`, `cc`,
 * `display`, `subtitle`), и если бы инструмент говорил ими, у модели стало бы
 * два словаря на одну сущность — ровно то, из-за чего она путала `date` и
 * `startDate` на замере 07.09.2026.
 *
 * Чистая половина лежит отдельно от `index.ts` (там `Deno.serve` на загрузке, из
 * теста не подгрузить) — та же конвенция, что `mutateRules.ts` ↔ `mutate.ts`.
 */

import { bad, type FieldSpec, type Refusal, validateEach, validateFields } from '../_shared/mutateRules.ts';

/** = потолок батча `search_gazetteer_batch` (`where e.ord <= 50`). */
export const MAX_CITIES = 50;
/** = окно `search_gazetteer_core`; просить больше нечего. */
export const MAX_LIMIT = 10;
/** = домен `public.short_text`, как у драфта (`planTripWithAi/draft.ts`). */
const MAX_STR = 300;

const CITY_FIELDS: Record<string, FieldSpec> = {
  // Имя города так, как его назвала модель. Пустое имя искать нечего.
  city_name: {
    type: 'string',
    required: true,
    max: MAX_STR,
    validate: (v) => (String(v).trim() ? null : bad('Field "cities[].city_name" must not be empty')),
  },
  // Английское имя — второй заход резолва (у справочника есть alt-names, и
  // локализованное имя покрывает шире, а английское спасает мелкие иностранные).
  city_name_en: { type: 'string', max: MAX_STR },
  // ISO 3166-1 alpha-2. Для резолва это ЖЁСТКИЙ скоуп, а не подсказка: кандидаты
  // берутся только из этой страны (TRIP-159). Пустая строка = искать по всему миру.
  country_code: { type: 'string', max: 2 },
};

const eachCity = validateEach(CITY_FIELDS, 'cities');
const BODY_FIELDS: Record<string, FieldSpec> = {
  cities: {
    type: 'array',
    required: true,
    validate: (v) => (Array.isArray(v) && v.length > MAX_CITIES
      ? bad(`Field "cities" must have at most ${MAX_CITIES} entries`)
      : eachCity(v)),
  },
  // Язык подписей кандидатов (имя города и регион). Форма, не enum: список
  // языков живёт на фронте, и новый не должен ронять запрос на границе.
  language: { type: 'string', max: 8, nullable: true },
  // Сколько кандидатов на город. По умолчанию 5: меньше — и тёзка не покажется,
  // больше — модель тонет в пригородах (окно core всё равно 10).
  // ⚠️ Границы НЕ здесь, а зажимом в нормализации ниже — и это одна политика, а
  // не две: «сколько ни попроси, получишь от 1 до 10». Отбивать 0 или 99 отказом
  // значило бы ронять ход агента из-за его представления о числе, а не из-за
  // испорченного ввода. Спека держит только ТИП.
  limit: { type: 'number', nullable: true },
};

export type GazQuery = { city_name: string; city_name_en?: string; country_code?: string };
export type GazRequest = { cities: GazQuery[]; language: string; limit: number };

const LANGS = new Set(['en', 'es', 'ru']);

/**
 * Тело запроса → известная форма либо `Refusal` (400 `INVALID_INPUT`) —
 * тем же движком и с тем же контрактом отказа, что у шва записи.
 */
export function normalizeRequest(input: Record<string, unknown>): Refusal | GazRequest {
  const checked = validateFields(BODY_FIELDS, input, { insert: true });
  if ('status' in checked) return checked;
  const v = checked.values as { cities: Record<string, unknown>[]; language?: string | null; limit?: number | null };
  const lang = (v.language || 'en').slice(0, 2).toLowerCase();
  return {
    cities: v.cities.map((c) => ({
      city_name: String(c.city_name),
      city_name_en: c.city_name_en ? String(c.city_name_en) : '',
      country_code: c.country_code ? String(c.country_code).toUpperCase() : '',
    })),
    // Снимок `name_i18n` знает только языки приложения; всё прочее — английский.
    language: LANGS.has(lang) ? lang : 'en',
    limit: Math.min(Math.max(Math.trunc(v.limit ?? 5), 1), MAX_LIMIT),
  };
}

/** Запрос агента → payload `search_gazetteer_batch` (его словарь: `q`/`q_en`/`cc`). */
export const toRpcItems = (cities: GazQuery[]) =>
  cities.map((c) => ({ q: c.city_name, q_en: c.city_name_en || '', cc: c.country_code || '' }));
