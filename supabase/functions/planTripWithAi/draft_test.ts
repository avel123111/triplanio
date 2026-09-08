import { assertEquals } from 'jsr:@std/assert';
import { type Draft, MAX_NODES, MAX_STR, normalizeDraft } from './draft.ts';

// Тот же способ различить исход, что у шва записи (`mutate.ts`): отказ несёт `status`.
const isRefusal = (r: unknown): r is { status: number; code: string } => !!r && typeof r === 'object' && 'status' in r;
// Драфт успешного исхода: у отказа поля нет, и тест падает на первом же обращении.
const draftOf = (r: unknown) => (r as { draft: Draft }).draft;

// Драфт, каким его шлёт фронт (`toDraftPayload`): ровно эти поля, ничего лишнего.
const node = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref, kind: 'transit', city_name: 'Рим', city_name_en: 'Rome', country_code: 'IT', nights: 3, geonameid: 3169070, ...extra,
});
const refused = (r: unknown) => isRefusal(r) ? { status: r.status, code: r.code } : null;

Deno.test('нет драфта — законно (первая реплика): { draft: null }', () => {
  assertEquals(normalizeDraft(undefined), { draft: null });
  assertEquals(normalizeDraft(null), { draft: null });
});

Deno.test('форма фронта проходит как есть, лишние поля узла срезаются', () => {
  const r = draftOf(normalizeDraft({ startDate: '2026-10-01', title: 'Италия', nodes: [node('1', { latitude: 41.9, secret: 'x' })] }));
  assertEquals(r.nodes.length, 1);
  assertEquals(Object.keys(r.nodes[0]).sort(), ['city_name', 'city_name_en', 'country_code', 'geonameid', 'kind', 'nights', 'ref']);
  assertEquals(r.nodes[0].nights, 3);
  assertEquals(r.startDate, '2026-10-01');
});

Deno.test('якорь без ночей и без geonameid — null, дата null — законно', () => {
  const r = draftOf(normalizeDraft({ startDate: null, title: '', nodes: [node('s', { kind: 'start', nights: null, geonameid: null })] }));
  assertEquals(r.nodes[0].nights, null); assertEquals(r.startDate, null);
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
  assertEquals(isRefusal(normalizeDraft({ nodes: [node('1', { country_code: 'ITA' })] })), true, 'код страны — ISO alpha-2');
});

Deno.test('не объект, кривая дата, неизвестный kind, нет ref, строка вместо числа, нет nodes — отказ', () => {
  assertEquals(isRefusal(normalizeDraft([])), true);
  assertEquals(isRefusal(normalizeDraft({ startDate: '01.10.2026', nodes: [] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: [{ kind: 'transit', city_name: 'x' }] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: [node('')] })), true, 'пустой ref — не ссылка');
  assertEquals(isRefusal(normalizeDraft({ nodes: [node('1', { nights: '3' })] })), true);
  assertEquals(isRefusal(normalizeDraft({ nodes: 'x' })), true);
  assertEquals(isRefusal(normalizeDraft({ title: 'x' })), true);
});
