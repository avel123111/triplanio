// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByLocation } from './markers.js';
import { isMapAlive } from './alive.js';

// groupByLocation теперь несёт `ids` — единый источник для `data-mids`, которым
// `useCityMarkers` адресует пин при тогле выделения на ОБЕИХ картах. Раньше id
// вынимался по-разному в MapView (`data-vids` из visit.id) и FlowMap (`data-mid`
// из сырого id); тест пинит, что группировка собирает их в одном поле.
test('groupByLocation: собирает ids вместе с labels/kinds/data', () => {
  const [g] = groupByLocation([
    { id: 'a', lng: 10, lat: 20, label: '1', kind: 'transit', data: { id: 'a' } },
  ]);
  assert.deepEqual(g.ids, ['a']);
  assert.deepEqual(g.labels, ['1']);
  assert.deepEqual(g.kinds, ['transit']);
  assert.equal(g.data.length, 1);
});

test('groupByLocation: совпадающие координаты схлопываются в один пин со всеми ids', () => {
  const groups = groupByLocation([
    { id: 'a', lng: 10, lat: 20, label: '1', kind: 'transit' },
    { id: 'b', lng: 10, lat: 20, label: '2', kind: 'transit' }, // тот же спот
    { id: 'c', lng: 30, lat: 40, label: '3', kind: 'transit' },
  ]);
  assert.equal(groups.length, 2);
  const shared = groups.find((g) => g.ids.length === 2);
  assert.deepEqual(shared.ids, ['a', 'b']);
  assert.deepEqual(shared.labels, ['1', '2']);
});

test('groupByLocation: точки без координат отбрасываются; id может отсутствовать', () => {
  const groups = groupByLocation([
    { id: undefined, lng: 1, lat: 2, label: null }, // без id (как у stats-карты)
    { id: 'x', lng: null, lat: 2, label: '1' },      // без lng — выкидывается
    null,                                            // мусор
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, [undefined]);
});

// isMapAlive: предикат «по карте безопасно читать слои» — жив ли style.
test('isMapAlive: истинно только при живом style', () => {
  assert.equal(isMapAlive(null), false);
  assert.equal(isMapAlive(undefined), false);
  assert.equal(isMapAlive({}), false);            // ссылка жива, style снесён
  assert.equal(isMapAlive({ style: null }), false);
  assert.equal(isMapAlive({ style: {} }), true);
});
