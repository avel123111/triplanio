import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSlotInsets } from './mapShellSlot.js';

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

test('телефон: шит режет ВЫСОТУ — её забирает слот, камера чиста', () => {
  // Отступ камеры снизу заставил бы шар отъехать и стать меньше свободного
  // окна (замер: 34 точки рамки из 44 вне планеты против 0 у слота).
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 612 }), { slot: { bottom: 592, left: 0 }, camera: NONE });
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 135 }), { slot: { bottom: 115, left: 0 }, camera: NONE });
});

test('десктоп: панель режет ШИРИНУ — карта во всю площадь, кадр уводит камера', () => {
  assert.deepEqual(mapSlotInsets({ panelPx: 550 }), { slot: { bottom: 0, left: 0 }, camera: { ...NONE, left: 550 } });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapSlotInsets({ panelPx: 550, collapsed: true }), { slot: { bottom: 0, left: 0 }, camera: NONE });
});

test('режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapSlotInsets({ phone: false, sheetPx: 612, panelPx: 550 }),
    { slot: { bottom: 0, left: 0 }, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 612, panelPx: 550 }),
    { slot: { bottom: 592, left: 0 }, camera: NONE });
});

test('заход под скругление не уводит слот в минус', () => {
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 12 }), { slot: { bottom: 0, left: 0 }, camera: NONE });
});

test('немеряный слот вырождается в «карта во всю площадь»', () => {
  for (const bad of [0, -40, NaN, undefined, null]) {
    assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }), { slot: { bottom: 0, left: 0 }, camera: NONE });
    assert.deepEqual(mapSlotInsets({ panelPx: /** @type {any} */ (bad) }), { slot: { bottom: 0, left: 0 }, camera: NONE });
  }
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapSlotInsets(), { slot: { bottom: 0, left: 0 }, camera: NONE });
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 611.6 }), { slot: { bottom: 592, left: 0 }, camera: NONE });
  assert.deepEqual(mapSlotInsets({ panelPx: 549.6 }), { slot: { bottom: 0, left: 0 }, camera: { ...NONE, left: 550 } });
});
