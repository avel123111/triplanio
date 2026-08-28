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
test('по горизонтали хватает собственной ширины с запасом', () => {
  const r = { width: 400, bottom: 80 };
  assert.ok(swipeExit('right', r).x > 400);
  assert.ok(swipeExit('left', r).x < -400);
  assert.equal(swipeExit('right', r).y, 0);
});

test('★ вверх считается от НИЖНЕЙ кромки: карточка из середины деки обязана уйти целиком', () => {
  const mid = swipeExit('up', { width: 400, bottom: 240 });
  // собственной высоты (60) не хватило бы — она встала бы на виду
  assert.ok(mid.y < -240, 'улетает дальше своей нижней кромки');
  assert.equal(mid.x, 0);
});

test('без направления смещения нет', () => {
  assert.deepEqual(swipeExit(null, { width: 400, bottom: 80 }), { x: 0, y: 0 });
  assert.deepEqual(swipeExit('up'), { x: 0, y: -32 });
});
