import { assertEquals } from 'jsr:@std/assert';
import { MAX_NODES, MAX_STR, normalizeDraft } from './draft.ts';

// Драфт, каким его шлёт фронт (`toDraftPayload`): ровно эти поля, ничего лишнего.
const node = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref, kind: 'transit', city_name: 'Рим', city_name_en: 'Rome', country_code: 'IT', nights: 3, geonameid: 3169070, ...extra,
});

Deno.test('нет драфта — законно (первая реплика): ok и null', () => {
  assertEquals(normalizeDraft(undefined), { ok: true, draft: null });
  assertEquals(normalizeDraft(null), { ok: true, draft: null });
});

Deno.test('форма фронта проходит как есть, лишние поля узла срезаются', () => {
  const r = normalizeDraft({ startDate: '2026-10-01', title: 'Италия', nodes: [node('1', { latitude: 41.9, secret: 'x' })] });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.draft?.nodes.length, 1);
    assertEquals(Object.keys(r.draft!.nodes[0]).sort(), ['city_name', 'city_name_en', 'country_code', 'geonameid', 'kind', 'nights', 'ref']);
    assertEquals(r.draft?.nodes[0].nights, 3);
  }
});

Deno.test('якорь без ночей и без geonameid — null, не ошибка', () => {
  const r = normalizeDraft({ startDate: '', title: '', nodes: [node('s', { kind: 'start', nights: null, geonameid: null })] });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.draft?.nodes[0].nights, null);
});

Deno.test('★ потолок узлов: 60 проходит, 61 — 400', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => node(String(i)));
  assertEquals(normalizeDraft({ nodes: many(MAX_NODES) }).ok, true);
  const r = normalizeDraft({ nodes: many(MAX_NODES + 1) });
  assertEquals(r.ok, false);
});

Deno.test('★ потолок строки: 200 проходит, 201 — 400', () => {
  assertEquals(normalizeDraft({ title: 'a'.repeat(MAX_STR), nodes: [] }).ok, true);
  assertEquals(normalizeDraft({ title: 'a'.repeat(MAX_STR + 1), nodes: [] }).ok, false);
  assertEquals(normalizeDraft({ nodes: [node('1', { city_name: 'x'.repeat(MAX_STR + 1) })] }).ok, false);
});

Deno.test('не объект, кривая дата, неизвестный kind, пустой ref, строка вместо числа — 400', () => {
  assertEquals(normalizeDraft('draft').ok, false);
  assertEquals(normalizeDraft([]).ok, false);
  assertEquals(normalizeDraft({ startDate: '01.10.2026', nodes: [] }).ok, false);
  assertEquals(normalizeDraft({ nodes: [node('1', { kind: 'moon' })] }).ok, false);
  assertEquals(normalizeDraft({ nodes: [node('', {})] }).ok, false);
  assertEquals(normalizeDraft({ nodes: [node('1', { nights: '3' })] }).ok, false);
  assertEquals(normalizeDraft({ nodes: 'x' }).ok, false);
});
