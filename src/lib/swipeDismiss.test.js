import test from 'node:test';
import assert from 'node:assert/strict';
import {
  swipeAxis, swipeOffset, swipeCommit, swipeExit,
  SWIPE_INTENT_PX, SWIPE_COMMIT_PX, SWIPE_FLICK_VELOCITY,
} from './swipeDismiss.js';

// ── ось ──────────────────────────────────────────────────────────────────────
test('до порога намерения оси нет — это ещё тап', () => {
  assert.equal(swipeAxis(0, 0), null);
  assert.equal(swipeAxis(SWIPE_INTENT_PX - 1, SWIPE_INTENT_PX - 1), null);
  assert.equal(swipeAxis(-(SWIPE_INTENT_PX - 1), 2), null);
});

test('ось выбирается по большей проекции', () => {
  assert.equal(swipeAxis(30, 4), 'x');
  assert.equal(swipeAxis(-30, 4), 'x');
  assert.equal(swipeAxis(4, -30), 'y');
});

test('на идеальной диагонали выигрывает вертикаль — сторона с упором', () => {
  assert.equal(swipeAxis(20, 20), 'y');
  assert.equal(swipeAxis(-20, -20), 'y');
});

// ── смещение: путь карточки ────────────────────────────────────────────────
test('по второй оси смещения нет вовсе — это и есть замок', () => {
  assert.equal(swipeOffset('x', 40, 25).y, 0);
  assert.equal(swipeOffset('y', 40, -25).x, 0);
});

test('★★ порог ВЫЧИТАЕТСЯ: путь начинается с нуля, без скачка на 6px', () => {
  // до порога карточка стоит
  assert.equal(swipeOffset('x', SWIPE_INTENT_PX, 0).x, 0);
  // сразу за порогом — единица, а не весь порог разом
  assert.equal(swipeOffset('x', SWIPE_INTENT_PX + 1, 0).x, 1);
  assert.equal(swipeOffset('x', SWIPE_INTENT_PX + 20, 0).x, 20);
  assert.equal(swipeOffset('y', 0, -(SWIPE_INTENT_PX + 20)).y, -20);
});

test('★ путь монотонен и НЕ переворачивает знак, когда палец идёт назад', () => {
  // ось выбрана горизонталью, палец вернулся почти в начало
  for (let dx = 0; dx <= SWIPE_INTENT_PX; dx += 1) {
    assert.equal(swipeOffset('x', dx, 0).x, 0, `dx=${dx}`);
    assert.equal(swipeOffset('x', -dx, 0).x, 0, `dx=${-dx}`);
  }
  const seq = [7, 10, 30, 60].map((d) => swipeOffset('x', d, 0).x);
  assert.deepEqual(seq, [1, 4, 24, 54]);
  assert.ok(seq.every((v, i) => i === 0 || v > seq[i - 1]), 'строго возрастает');
});

test('★ тяга ВНИЗ упирается в ноль: у деки нет края снизу, там контент', () => {
  assert.deepEqual(swipeOffset('y', 0, 120), { x: 0, y: 0 });
  assert.deepEqual(swipeOffset('y', 0, 1), { x: 0, y: 0 });
});

test('без оси карточка стоит', () => {
  assert.deepEqual(swipeOffset(null, 99, -99), { x: 0, y: 0 });
});

// ── решение на отпускании ────────────────────────────────────────────────────
test('дистанция закрывает в обе стороны по горизонтали', () => {
  assert.equal(swipeCommit({ axis: 'x', x: SWIPE_COMMIT_PX, y: 0 }), 'right');
  assert.equal(swipeCommit({ axis: 'x', x: -SWIPE_COMMIT_PX, y: 0 }), 'left');
});

test('не дотянул и не бросил — не закрывает', () => {
  assert.equal(swipeCommit({ axis: 'x', x: SWIPE_COMMIT_PX - 1, y: 0, vx: 0 }), null);
  assert.equal(swipeCommit({ axis: 'y', x: 0, y: -(SWIPE_COMMIT_PX - 1), vy: 0 }), null);
});

test('★ решение меряется ПУТЁМ карточки: сырое смещение пальца закрывало бы раньше', () => {
  // палец уехал ровно на порог закрытия, но карточка отстаёт на порог намерения
  const finger = SWIPE_COMMIT_PX;
  const travel = swipeOffset('x', finger, 0).x;
  assert.ok(travel < SWIPE_COMMIT_PX, 'путь меньше смещения пальца');
  assert.equal(swipeCommit({ axis: 'x', x: travel, y: 0 }), null, 'ещё не закрывает');
  assert.equal(swipeCommit({ axis: 'x', x: swipeOffset('x', finger + SWIPE_INTENT_PX, 0).x, y: 0 }), 'right');
});

test('★ бросок закрывает на любой дистанции — иначе быстрый короткий свайп «не работает»', () => {
  assert.equal(swipeCommit({ axis: 'x', x: 2, y: 0, vx: SWIPE_FLICK_VELOCITY }), 'right');
  assert.equal(swipeCommit({ axis: 'x', x: -2, y: 0, vx: -SWIPE_FLICK_VELOCITY }), 'left');
  assert.equal(swipeCommit({ axis: 'y', x: 0, y: -2, vy: -SWIPE_FLICK_VELOCITY }), 'up');
});

test('★ направление берёт СКОРОСТЬ, а не путь: уехал вправо, бросил влево', () => {
  assert.equal(swipeCommit({ axis: 'x', x: 40, y: 0, vx: -SWIPE_FLICK_VELOCITY }), 'left');
});

test('★ вниз не закрывает НИКАК — ни дистанцией, ни броском', () => {
  assert.equal(swipeCommit({ axis: 'y', x: 0, y: 0, vy: 0 }), null);
  assert.equal(swipeCommit({ axis: 'y', x: 0, y: 0, vy: 5 }), null);
});

test('без оси решения нет', () => {
  assert.equal(swipeCommit({ axis: null, x: 999, y: -999, vx: 9, vy: -9 }), null);
});

// ── куда улететь ─────────────────────────────────────────────────────────────
// Геометрия карточки в покое на телефоне: дека прижата к верху, высота ~60.
const REST = { left: 12, right: 378, bottom: 128 };
const VP = { width: 390 };
/** Прямоугольник карточки, утащенной вверх на `d`. */
const draggedUp = (d) => ({ ...REST, bottom: REST.bottom - d });
/** …и утащенной вбок на `d` (+ вправо). */
const draggedX = (d) => ({ ...REST, left: REST.left + d, right: REST.right + d });

test('★★ РЕГРЕССИЯ: путь наружу НЕ ЗАВИСИТ от того, насколько далеко утащили', () => {
  // Первая редакция считала от прямоугольника без пути, и ответ гулял:
  // 20px → -140 (летит), 80px → -80 (стоит), 110px → -50 (прыгает назад).
  const ends = [10, 20, 60, 80, 110].map(
    (d) => swipeExit('up', { x: 0, y: -d }, draggedUp(d), VP).y,
  );
  assert.equal(new Set(ends).size, 1, `все должны приехать в одну точку, а приехали в ${ends}`);
});

test('★★ РЕГРЕССИЯ: карточка НИКОГДА не едет назад — только дальше от края', () => {
  for (const d of [0, 5, 40, 80, 110, 160, 400]) {
    assert.ok(swipeExit('up', { x: 0, y: -d }, draggedUp(d), VP).y <= -d, `вверх, утащено ${d}`);
    assert.ok(swipeExit('left', { x: -d, y: 0 }, draggedX(-d), VP).x <= -d, `влево, утащено ${d}`);
    assert.ok(swipeExit('right', { x: d, y: 0 }, draggedX(d), VP).x >= d, `вправо, утащено ${d}`);
  }
});

test('★ уже за краем — остаётся на месте, а не откатывается', () => {
  // карточка полностью выше вьюпорта: остаток до края нулевой
  const e = swipeExit('up', { x: 0, y: -400 }, { ...REST, bottom: -100 }, VP);
  assert.equal(e.y, -400);
});

test('вверх уводит нижнюю кромку за верх экрана', () => {
  const travelY = -30;
  const rect = draggedUp(30);
  const e = swipeExit('up', { x: 0, y: travelY }, rect, VP);
  // сдвиг относительно текущего положения = e.y - travelY
  assert.ok(rect.bottom + (e.y - travelY) < 0, 'нижняя кромка ушла выше нуля');
});

test('вбок уводит соответствующую кромку за свой край экрана', () => {
  const l = swipeExit('left', { x: 0, y: 0 }, REST, VP);
  assert.ok(REST.right + l.x < 0, 'правая кромка ушла левее нуля');
  const r = swipeExit('right', { x: 0, y: 0 }, REST, VP);
  assert.ok(REST.left + r.x > VP.width, 'левая кромка ушла правее экрана');
});

test('без направления путь не меняется', () => {
  assert.deepEqual(swipeExit(null, { x: 7, y: -3 }, REST, VP), { x: 7, y: -3 });
});
