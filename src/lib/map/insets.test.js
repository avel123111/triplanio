import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMapInsets, offsetForInsets, setMapInsets } from './insets.js';

test('по умолчанию карта ничем не закрыта', () => {
  assert.deepEqual(getMapInsets({}), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(getMapInsets(null), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('★★ закрытая площадь даёт СДВИГ камеры, а не отступ вьюпорта', () => {
  // Замерено на живой карте: большой отступ на globe роняет зум (шит 500 из 620
  // дал zoom 0.41) и рвёт лимб атмосферы — отсюда «круг вокруг глобуса». Сдвиг
  // тех же величин даёт нормальный зум и уводит цель из-под шита.
  const map = {};
  setMapInsets(map, { bottom: 300 });
  assert.deepEqual(offsetForInsets(getMapInsets(map)), [0, -150]);
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
