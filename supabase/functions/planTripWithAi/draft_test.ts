import { assertEquals } from 'jsr:@std/assert';
import { MAX_NODES, MAX_STR, isRefusal, normalizeDraft } from './draft.ts';

// Драфт, каким его шлёт фронт (`toDraftPayload`): ровно эти поля, ничего лишнего.
const node = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref, kind: 'transit', city_name: 'Рим', city_name_en: 'Rome', country_code: 'IT', nights: 3, geonameid: 3169070, ...extra,
});
const refused = (r: unknown) => isRefusal(r) ? { status: r.status, code: r.code } : null;

Deno.test('нет драфта — законно (первая реплика): null', () => {
  assertEquals(normalizeDraft(undefined), null);
  assertEquals(normalizeDraft(null), null);
});

Deno.test('форма фронта проходит как есть, лишние поля узла срезаются', () => {
  const r = normalizeDraft({ startDate: '2026-10-01', title: 'Италия', nodes: [node('1', { latitude: 41.9, secret: 'x' })] });
  assertEquals(isRefusal(r), false);
  if (!isRefusal(r) && r) {
    assertEquals(r.nodes.length, 1);
    assertEquals(Object.keys(r.nodes[0]).sort(), ['city_name', 'city_name_en', 'country_code', 'geonameid', 'kind', 'nights', 'ref']);
    assertEquals(r.nodes[0].nights, 3);
    assertEquals(r.startDate, '2026-10-01');
  }
});

Deno.test('якорь без ночей и без geonameid — null, дата null — законно', () => {
  const r = normalizeDraft({ startDate: null, title: '', nodes: [node('s', { kind: 'start', nights: null, geonameid: null })] });
  assertEquals(isRefusal(r), false);
  if (!isRefusal(r) && r) { assertEquals(r.nodes[0].nights, null); assertEquals(r.startDate, null); }
});

Deno.test('★ отказ — контракт общего шва: 400 INVALID_INPUT, не свой код', () => {
  assertEquals(refused(normalizeDraft('draft')), { status: 400, code: 'INVALID_INPUT' });
  assertEquals(refused(normalizeDraft({ nodes: [node('1', { kind: 'moon' })] })), { status: 400, code: 'INVALID_INPUT' });
});

Deno.test('★ потолок узлов: 60 проходит, 61 — отказ', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => node(String(i)));
  assertEquals(isRefusal(normalizeDraft({ nodes: many(MAX_NODES) })), false);
  assertEquals(isRefusal(normalizeDraft({ nodes: many(MAX_NODES + 1) })), true);
});

Deno.test('★ потолок строки = домен short_text: 300 проходит, 301 — отказ', () => {
  assertEquals(MAX_STR, 300);
  assertEquals(isRefusal(normalizeDraft({ title: 'a'.repeat(MAX_STR), nodes: [] })), false);
  assertEquals(isRefusal(normalizeDraft({ title: 'a'.repeat(MAX_STR + 1), nodes: [] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: [node('1', { city_name: 'x'.repeat(MAX_STR + 1) })] })), true);
});

Deno.test('не объект, кривая дата, неизвестный kind, нет ref, строка вместо числа, нет nodes — отказ', () => {
  assertEquals(isRefusal(normalizeDraft([])), true);
  assertEquals(isRefusal(normalizeDraft({ startDate: '01.10.2026', nodes: [] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: [{ kind: 'transit', city_name: 'x' }] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: [node('1', { nights: '3' })] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: 'x' })), true);
  assertEquals(isRefusal(normalizeDraft({ title: 'x' })), true);
});
