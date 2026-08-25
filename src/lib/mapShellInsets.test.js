import test from 'node:test';
import assert from 'node:assert/strict';
import { mapShellInsets, slotChangeDelay } from './mapShellInsets.js';

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

test('★★ ТЕЛЕФОН: шит режет ВЫСОТУ — её забирает СЛОТ, камера чиста', () => {
  // Размер глобуса mapbox считает от высоты ХОЛСТА. Оставь холст во весь экран,
  // а свободным местом полоску — и высоты разойдутся втрое: шар считается от
  // одной, показывается в другой. Именно так его и сломали.
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, cornerPx: 20 }), { slotBottom: 592, slotUnder: 20, camera: NONE });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 135, cornerPx: 20 }), { slotBottom: 115, slotUnder: 20, camera: NONE });
});

test('★★ ДЕСКТОП: панель режет ШИРИНУ — холст целый, кадр уводит камера', () => {
  // По вертикали не закрыто ничего, высота холста = высоте свободного окна →
  // размер шара попадает точно и без сжатия холста.
  assert.deepEqual(mapShellInsets({ panelPx: 550 }), { slotBottom: 0, slotUnder: 0, camera: { ...NONE, left: 550 } });
});

test('свёрнутая панель не закрывает ничего', () => {
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true }), { slotBottom: 0, slotUnder: 0, camera: NONE });
});

test('★ ОТКРЫТЫЙ СЛОЙ уводит кадр карты — и при свёрнутом маршруте тоже', () => {
  // Слой города/события — независимый виджет той же колонки: его наличие не
  // зависит от свёрнутости маршрута, поэтому свёрнутый маршрут + открытый слой
  // всё равно закрывают левую ширину (иначе фокус карты оказывался под слоем).
  assert.deepEqual(mapShellInsets({ panelPx: 550, collapsed: true, overlayPx: 604 }),
    { slotBottom: 0, slotUnder: 0, camera: { ...NONE, left: 604 } });
  // Максимум из двух: панель открыта (550) и слой (604) — берём бо́льший край.
  assert.deepEqual(mapShellInsets({ panelPx: 550, overlayPx: 604 }),
    { slotBottom: 0, slotUnder: 0, camera: { ...NONE, left: 604 } });
  // Только слой (маршрут не мерян) — кадр всё равно уводится.
  assert.deepEqual(mapShellInsets({ overlayPx: 604 }),
    { slotBottom: 0, slotUnder: 0, camera: { ...NONE, left: 604 } });
});

test('★ режимы не смешиваются: чужая величина не читается', () => {
  // Шит в портале успевает подержать прошлую высоту на переходе в десктоп —
  // прочитать её значит отрезать у десктопной карты низ по призраку.
  assert.deepEqual(mapShellInsets({ phone: false, sheetPx: 612, panelPx: 550, cornerPx: 20 }),
    { slotBottom: 0, slotUnder: 0, camera: { ...NONE, left: 550 } });
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 612, panelPx: 550, cornerPx: 20 }),
    { slotBottom: 592, slotUnder: 20, camera: NONE });
});

test('заход под скругление не уводит слот в минус', () => {
  assert.deepEqual(mapShellInsets({ phone: true, sheetPx: 12, cornerPx: 20 }), { slotBottom: 0, slotUnder: 12, camera: NONE });
});

test('★ немеряное вырождается в «карта во всю площадь», а не в минус', () => {
  for (const bad of [0, -40, NaN, Infinity, undefined, null, '550']) {
    assert.deepEqual(mapShellInsets({ phone: true, sheetPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, slotUnder: 0, camera: NONE });
    assert.deepEqual(mapShellInsets({ panelPx: /** @type {any} */ (bad) }),
      { slotBottom: 0, slotUnder: 0, camera: NONE });
  }
});

test('★ ЗАХОД ПОД ШИТ — ВТОРАЯ ПОЛОВИНА СЛОТА, И ОН НЕ БОЛЬШЕ САМОГО ШИТА', () => {
  // Его читает то, что экран кладёт ПОВЕРХ карты: «низ карты» у такого элемента —
  // низ КАНВАСА, а канвас намеренно уходит под шит на радиус скруглений. Без этой
  // величины отступ считается от точки под шитом — так пилюля планировщика и
  // оказывалась лежащей на нём.
  // Инвариант: слот + заход = высота шита ровно, на любых входах.
  for (const [sheet, corner] of [[612, 20], [135, 20], [12, 20], [0, 20], [400, 0]]) {
    const box = mapShellInsets({ phone: true, sheetPx: sheet, cornerPx: corner });
    assert.equal(box.slotBottom + box.slotUnder, Math.max(0, sheet), `${sheet}/${corner}`);
    // Условие разбито на две строки не для красоты: знаки «больше» и «меньше» на
    // ОДНОЙ строке сканер i18n читает как JSX-текст (та же ловушка, что у разбора
    // жеста в `sheetDetents`).
    assert.ok(box.slotUnder >= 0, `заход не бывает отрицательным, ${sheet}/${corner}`);
    assert.ok(box.slotUnder <= Math.max(0, sheet), `заход не бывает больше шита, ${sheet}/${corner}`);
  }
  // Десктоп: шита нет — заходить не подо что, и читатель обязан получить ноль.
  assert.equal(mapShellInsets({ panelPx: 550 }).slotUnder, 0);
});

test('дробные измерения округляются (пиксель — целое)', () => {
  assert.equal(mapShellInsets({ phone: true, sheetPx: 611.6, cornerPx: 20 }).slotBottom, 592);
  assert.equal(mapShellInsets({ panelPx: 549.6 }).camera.left, 550);
});

test('без аргументов — карта во всю площадь', () => {
  assert.deepEqual(mapShellInsets(), { slotBottom: 0, slotUnder: 0, camera: NONE });
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
