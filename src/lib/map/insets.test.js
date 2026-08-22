import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMapInsets, offsetForInsets, setMapInsets, withMapInsets } from './insets.js';

test('по умолчанию карта ничем не закрыта', () => {
  assert.deepEqual(getMapInsets({}), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(getMapInsets(null), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('★ отступ вызова складывается с закрытой площадью', () => {
  const map = {};
  setMapInsets(map, { bottom: 300 });
  assert.deepEqual(withMapInsets(map, 60), { top: 60, right: 60, bottom: 360, left: 60 });
});

test('★★ снятие возвращает карту в «ничем не закрыта»', () => {
  // Экран ушёл — его панель не имеет права диктовать камеру следующему.
  const map = {};
  setMapInsets(map, { left: 500 });
  setMapInsets(map, null);
  assert.deepEqual(getMapInsets(map), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('карты не делят отступы между собой', () => {
  const a = {}, b = {};
  setMapInsets(a, { bottom: 200 });
  assert.equal(getMapInsets(b).bottom, 0);
});

test('★ одиночная точка уводится из-под панели, а не остаётся по центру', () => {
  assert.deepEqual(offsetForInsets({ bottom: 400 }), [0, -200]);
  assert.deepEqual(offsetForInsets({ left: 500 }), [250, 0]);
  assert.deepEqual(offsetForInsets({ top: 0, right: 0, bottom: 0, left: 0 }), [0, 0]);
});
