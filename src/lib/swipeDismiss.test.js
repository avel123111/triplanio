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

// ── смещение ─────────────────────────────────────────────────────────────────
test('по второй оси смещения нет вовсе — это и есть замок', () => {
  assert.deepEqual(swipeOffset('x', 40, 25), { x: 40, y: 0 });
  assert.deepEqual(swipeOffset('y', 40, -25), { x: 0, y: -25 });
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
  assert.equal(swipeCommit({ axis: 'x', dx: SWIPE_COMMIT_PX, dy: 0 }), 'right');
  assert.equal(swipeCommit({ axis: 'x', dx: -SWIPE_COMMIT_PX, dy: 0 }), 'left');
});

test('не дотянул и не бросил — не закрывает', () => {
  assert.equal(swipeCommit({ axis: 'x', dx: SWIPE_COMMIT_PX - 1, dy: 0, vx: 0 }), null);
  assert.equal(swipeCommit({ axis: 'y', dx: 0, dy: -(SWIPE_COMMIT_PX - 1), vy: 0 }), null);
});

test('★ бросок закрывает на любой дистанции — иначе быстрый короткий свайп «не работает»', () => {
  assert.equal(swipeCommit({ axis: 'x', dx: 8, dy: 0, vx: SWIPE_FLICK_VELOCITY }), 'right');
  assert.equal(swipeCommit({ axis: 'x', dx: -8, dy: 0, vx: -SWIPE_FLICK_VELOCITY }), 'left');
  assert.equal(swipeCommit({ axis: 'y', dx: 0, dy: -8, vy: -SWIPE_FLICK_VELOCITY }), 'up');
});

test('★ направление берёт СКОРОСТЬ, а не смещение: уехал вправо, бросил влево', () => {
  assert.equal(swipeCommit({ axis: 'x', dx: 40, dy: 0, vx: -SWIPE_FLICK_VELOCITY }), 'left');
});

test('★ вниз не закрывает НИКАК — ни дистанцией, ни броском', () => {
  assert.equal(swipeCommit({ axis: 'y', dx: 0, dy: 300, vy: 0 }), null);
  assert.equal(swipeCommit({ axis: 'y', dx: 0, dy: 300, vy: 5 }), null);
});

test('без оси решения нет', () => {
  assert.equal(swipeCommit({ axis: null, dx: 999, dy: -999, vx: 9, vy: -9 }), null);
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
