import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSlotInsets } from './mapShellSlot.js';

test('телефон: карта кончается там, где начинается шит', () => {
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 612 }), { bottom: 612, left: 0 });
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 135 }), { bottom: 135, left: 0 });
});

test('десктоп: карта кончается там, где кончается панель', () => {
  assert.deepEqual(mapSlotInsets({ panelPx: 550 }), { bottom: 0, left: 550 });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapSlotInsets({ panelPx: 550, collapsed: true }), { bottom: 0, left: 0 });
});

test('режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapSlotInsets({ phone: false, sheetPx: 612, panelPx: 550 }), { bottom: 0, left: 550 });
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 612, panelPx: 550 }), { bottom: 612, left: 0 });
});

test('немеряный слот вырождается в «карта во всю площадь»', () => {
  for (const bad of [0, -40, NaN, undefined, null]) {
    assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }), { bottom: 0, left: 0 });
    assert.deepEqual(mapSlotInsets({ panelPx: /** @type {any} */ (bad) }), { bottom: 0, left: 0 });
  }
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapSlotInsets(), { bottom: 0, left: 0 });
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.deepEqual(mapSlotInsets({ phone: true, sheetPx: 611.6 }), { bottom: 612, left: 0 });
});
