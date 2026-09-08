import { assertEquals } from 'jsr:@std/assert';
import { MAX_CITIES, MAX_LIMIT, normalizeRequest, toRpcItems } from './request.ts';

// Тот же способ различить исход, что у шва записи (`mutate.ts`): отказ несёт `status`.
const isRefusal = (r: unknown): r is { status: number; code: string } => !!r && typeof r === 'object' && 'status' in r;
const refused = (r: unknown) => (isRefusal(r) ? { status: r.status, code: r.code } : null);
const ok = (r: unknown) => r as { cities: { city_name: string; city_name_en?: string; country_code?: string }[]; language: string; limit: number };

const body = (extra: Record<string, unknown> = {}) => ({ cities: [{ city_name: 'Портленд', city_name_en: 'Portland', country_code: 'us' }], ...extra });

Deno.test('запрос агента проходит: страна в верхнем регистре, дефолты языка и числа кандидатов', () => {
  const r = ok(normalizeRequest(body()));
  assertEquals(r.cities[0].country_code, 'US', 'скоуп страны сравнивается в верхнем регистре');
  assertEquals(r.language, 'en', 'язык не назван — подписи по-английски');
  assertEquals(r.limit, 5, 'по умолчанию пять кандидатов');
});

Deno.test('★ имена полей — из словаря МОДЕЛИ, в словарь RPC переводит одна дверь', () => {
  // Увидено красным: пока перевод жил в обработчике, у одной сущности было два
  // словаря (`city_name` у модели, `q` у RPC) — тот же класс, что путаница
  // `date`/`startDate` на замере 07.09.2026.
  assertEquals(toRpcItems(ok(normalizeRequest(body())).cities), [{ q: 'Портленд', q_en: 'Portland', cc: 'US' }]);
  assertEquals(toRpcItems(ok(normalizeRequest(body({ cities: [{ city_name: 'Рим' }] }))).cities), [{ q: 'Рим', q_en: '', cc: '' }]);
});

Deno.test('★ язык — только языки приложения, остальное английский (снимок name_i18n других не знает)', () => {
  assertEquals(ok(normalizeRequest(body({ language: 'ru' }))).language, 'ru');
  assertEquals(ok(normalizeRequest(body({ language: 'ru-RU' }))).language, 'ru', 'тег региона режется до языка');
  assertEquals(ok(normalizeRequest(body({ language: 'de' }))).language, 'en');
  assertEquals(ok(normalizeRequest(body({ language: null }))).language, 'en');
});

Deno.test('★ число кандидатов зажато окном справочника, а не тем, что попросил агент', () => {
  assertEquals(ok(normalizeRequest(body({ limit: 1 }))).limit, 1);
  assertEquals(ok(normalizeRequest(body({ limit: 99 }))).limit, MAX_LIMIT, 'выше окна core просить нечего');
  assertEquals(ok(normalizeRequest(body({ limit: 0 }))).limit, 1);
  assertEquals(ok(normalizeRequest(body({ limit: 3.7 }))).limit, 3);
});

Deno.test('★ отказ — контракт общего шва, а не свой', () => {
  assertEquals(refused(normalizeRequest({})), { status: 400, code: 'INVALID_INPUT' }, 'список городов обязателен');
  assertEquals(refused(normalizeRequest({ cities: 'Рим' })), { status: 400, code: 'INVALID_INPUT' });
  assertEquals(refused(normalizeRequest({ cities: [{ city_name: '  ' }] })), { status: 400, code: 'INVALID_INPUT' }, 'пробелы — не имя');
  assertEquals(refused(normalizeRequest({ cities: [{ city_name_en: 'Rome' }] })), { status: 400, code: 'INVALID_INPUT' }, 'имя обязательно');
  assertEquals(refused(normalizeRequest(body({ cities: [{ city_name: 'Рим', country_code: 'ITA' }] }))), { status: 400, code: 'INVALID_INPUT' }, 'страна — alpha-2');
  const many = Array.from({ length: MAX_CITIES + 1 }, () => ({ city_name: 'Рим' }));
  assertEquals(refused(normalizeRequest({ cities: many })), { status: 400, code: 'INVALID_INPUT' }, 'потолок батча = потолок RPC');
  assertEquals(isRefusal(normalizeRequest({ cities: Array.from({ length: MAX_CITIES }, () => ({ city_name: 'Рим' })) })), false);
});
