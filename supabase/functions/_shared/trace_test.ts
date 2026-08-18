/**
 * TRIP-373 — тест-пин парсера входящего `sentry-trace` (сшивка сквозного трейса
 * браузер → edge). Ловит регрессы контракта: что распознаём как валидный трейс и
 * что молча роняем в `undefined` (нет заголовка / мусор / неверная длина).
 *
 * Модуль `trace.ts` намеренно без env и без `npm:@sentry/deno` (только Web
 * `crypto` + `Request`), поэтому импортируется под `deno test` БЕЗ `--allow-env`/
 * `--allow-net` — тот же приём, что `mutateResponse_test.ts`.
 *
 * Запуск: deno test supabase/functions/_shared/trace_test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert@^1.0.8';
import { traceContextFromRequest } from './trace.ts';

const TRACE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32 hex
const SPAN_ID = 'bbbbbbbbbbbbbbbb'; // 16 hex

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://edge.example/functions/v1/getMe', { headers });
}

Deno.test('valid — 3-part (с sampled) → trace_id + parent_span_id, свой span_id', () => {
  const ctx = traceContextFromRequest(reqWith({ 'sentry-trace': `${TRACE_ID}-${SPAN_ID}-1` }));
  assert(ctx, 'ожидали распарсенный контекст');
  assertEquals(ctx.trace_id, TRACE_ID);
  assertEquals(ctx.parent_span_id, SPAN_ID); // входящий span становится РОДИТЕЛЕМ
  assertEquals(ctx.span_id.length, 16); // событие получает СВОЙ span
  assert(/^[0-9a-f]{16}$/.test(ctx.span_id), 'span_id — 16 hex');
  assert(ctx.span_id !== SPAN_ID, 'свой span_id, не эхо родителя');
});

Deno.test('valid — 2-part (без sampled) тоже принимается, hex нормализуется в lower', () => {
  const ctx = traceContextFromRequest(
    reqWith({ 'sentry-trace': `${TRACE_ID.toUpperCase()}-${SPAN_ID.toUpperCase()}` }),
  );
  assert(ctx);
  assertEquals(ctx.trace_id, TRACE_ID);
  assertEquals(ctx.parent_span_id, SPAN_ID);
});

Deno.test('valid — окружающие пробелы обрезаются', () => {
  const ctx = traceContextFromRequest(reqWith({ 'sentry-trace': `  ${TRACE_ID}-${SPAN_ID}  ` }));
  assert(ctx);
  assertEquals(ctx.trace_id, TRACE_ID);
});

Deno.test('absent — нет заголовка → undefined (браузер трейс не прокинул)', () => {
  assertEquals(traceContextFromRequest(reqWith({})), undefined);
});

Deno.test('malformed — мусор → undefined', () => {
  assertEquals(traceContextFromRequest(reqWith({ 'sentry-trace': 'garbage' })), undefined);
});

Deno.test('malformed — пустая строка → undefined', () => {
  assertEquals(traceContextFromRequest(reqWith({ 'sentry-trace': '' })), undefined);
});

Deno.test('wrong-length — короткий trace_id → undefined', () => {
  // 31 hex вместо 32
  const short = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assertEquals(traceContextFromRequest(reqWith({ 'sentry-trace': `${short}-${SPAN_ID}` })), undefined);
});

Deno.test('wrong-length — короткий span_id → undefined', () => {
  // 15 hex вместо 16
  const short = 'bbbbbbbbbbbbbbb';
  assertEquals(traceContextFromRequest(reqWith({ 'sentry-trace': `${TRACE_ID}-${short}` })), undefined);
});

Deno.test('malformed — не-hex символы → undefined', () => {
  const bad = 'gggggggggggggggggggggggggggggggg'; // 32 символа, но не hex
  assertEquals(traceContextFromRequest(reqWith({ 'sentry-trace': `${bad}-${SPAN_ID}` })), undefined);
});
