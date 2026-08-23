import test from 'node:test';
import assert from 'node:assert/strict';
import { mapShellInsets, slotChangeDelay } from './mapShellInsets.js';

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

test('★★ ТЕЛЕФОН: шит режет ВЫСОТУ — её забирает СЛОТ, камера чиста', () => {
  // Размер глобуса mapbox считает от высоты ХОЛСТА. Оставь холст во весь экран,
  // а свободным местом полоску — и высоты разойдутся втрое: шар считается от
  // одной, показывается в другой. Именно так его и сломали.
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, cornerPx: 20 }), { slotBottom: 592, camera: NONE });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 135, cornerPx: 20 }), { slotBottom: 115, camera: NONE });
});

test('★★ ДЕСКТОП: панель режет ШИРИНУ — холст целый, кадр уводит камера', () => {
  // По вертикали не закрыто ничего, высота холста = высоте свободного окна →
  // размер шара попадает точно и без сжатия холста.
  assert.deepEqual(mapShellInsets({ panelPx: 550 }), { slotBottom: 0, camera: { ...NONE, left: 550 } });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true }), { slotBottom: 0, camera: NONE });
});

test('★ режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapShellInsets({ phone: false, sheetPx: 612, panelPx: 550, cornerPx: 20 }),
    { slotBottom: 0, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, panelPx: 550, cornerPx: 20 }),
    { slotBottom: 592, camera: NONE });
});

test('заход под скругление не уводит слот в минус', () => {
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 12, cornerPx: 20 }), { slotBottom: 0, camera: NONE });
});

test('★ немеряное вырождается в «карта во всю площадь», а не в минус', () => {
  for (const bad of [0, -40, NaN, Infinity, undefined, null, '550']) {
    assert.deepEqual(mapShellInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, camera: NONE });
    assert.deepEqual(mapShellInsets({ panelPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, camera: NONE });
  }
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.equal(mapShellInsets({ phone: true, sheetPx: 611.6, cornerPx: 20 }).slotBottom, 592);
  assert.equal(mapShellInsets({ panelPx: 549.6 }).camera.left, 550);
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapShellInsets(), { slotBottom: 0, camera: NONE });
});

// ── момент смены размера слота ───────────────────────────────────────────────

test('★★ карта РАСТЁТ — размер применяется сразу', () => {
  // Шит едет вниз: карта занимает место заранее, шит съезжает по ней сверху.
  assert.equal(slotChangeDelay({ prev: 592, next: 115, settleMs: 320 }), 0);
});

test('★★ карта СЖИМАЕТСЯ — размер применяется после приезда шита', () => {
  // Обрежь её сразу — и между картой и шитом откроется полоса фона: замерено
  // до 351 px на 160 мс. Пока шит едет, её низ закрыт им самим.
  assert.equal(slotChangeDelay({ prev: 115, next: 592, settleMs: 320 }), 320);
});

test('★ инвариант: пока поверхность едет, карта занимает БОЛЬШИЙ из двух размеров', () => {
  for (const [prev, next] of [[0, 500], [500, 0], [100, 200], [200, 100], [300, 300]]) {
    const d = slotChangeDelay({ prev, next, settleMs: 320 });
    const покаЕдет = d > 0 ? prev : next; // что стоит в слоте во время движения
    assert.equal(покаЕдет, Math.min(prev, next),
      `отступ снизу обязан быть МЕНЬШИМ из двух (карта — большей), ${prev}→${next}`);
  }
});

test('без темпа задержки нет', () => {
  assert.equal(slotChangeDelay({ prev: 0, next: 500 }), 0);
  assert.equal(slotChangeDelay(), 0);
});
