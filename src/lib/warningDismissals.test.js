import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISMISSED_CAP,
  hotelWarnKey,
  loadDismissed,
  serializeDismissed,
  storageKey,
  transferWarnKey,
} from './warningDismissals.js';

test('ключи собираются детерминированно', () => {
  assert.equal(transferWarnKey('a', 'b'), 't:a:b');
  assert.equal(hotelWarnKey('c'), 'h:c');
  assert.equal(storageKey('trip1'), 'trip:dismissed-warnings:trip1');
});

test('loadDismissed: валидный массив строк проходит', () => {
  const set = loadDismissed(JSON.stringify(['t:a:b', 'h:c']));
  assert.deepEqual([...set].sort(), ['h:c', 't:a:b']);
});

test('loadDismissed: мусор превращается в пустой набор, не в краш', () => {
  assert.equal(loadDismissed(null).size, 0);
  assert.equal(loadDismissed(undefined).size, 0);
  assert.equal(loadDismissed('').size, 0);
  assert.equal(loadDismissed('не json').size, 0);
  assert.equal(loadDismissed('{"a":1}').size, 0); // не массив
  assert.deepEqual([...loadDismissed('["t:a:b", 42, null, {}]')], ['t:a:b']); // не-строки отфильтрованы
});

test('serializeDismissed: мёртвые визиты выкидываются, живые остаются', () => {
  const set = new Set(['t:a:b', 't:a:dead', 'h:b', 'h:dead']);
  assert.deepEqual(serializeDismissed(set, ['a', 'b']), ['t:a:b', 'h:b']);
});

test('serializeDismissed: у стыка живыми обязаны быть ОБА конца', () => {
  const set = new Set(['t:a:b']);
  assert.deepEqual(serializeDismissed(set, ['a']), []);
});

test('serializeDismissed: неизвестный вид ключа и ключ без id не пишутся', () => {
  const set = new Set(['x:a', 't:', 'h', 't:a:b']);
  assert.deepEqual(serializeDismissed(set, ['a', 'b']), ['t:a:b']);
});

test('serializeDismissed: кэп срезает старейшие, свежие выживают', () => {
  const ids = Array.from({ length: DISMISSED_CAP + 5 }, (_, i) => `v${i}`);
  const set = new Set(ids.map((id) => hotelWarnKey(id)));
  const out = serializeDismissed(set, ids);
  assert.equal(out.length, DISMISSED_CAP);
  assert.equal(out[out.length - 1], hotelWarnKey(`v${DISMISSED_CAP + 4}`)); // последний добавленный жив
  assert.ok(!out.includes(hotelWarnKey('v0'))); // самый старый срезан
});
