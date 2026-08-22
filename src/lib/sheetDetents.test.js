import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gestureOwner, nearestDetent, resolveDetents } from './sheetDetents.js';

const VH = 800;
const HEAD = 120; // грип + шапка + док + safe-area

/* ── Доли → пиксели ──────────────────────────────────────────────────────── */

test('доли переводятся в пиксели вьюпорта', () => {
  assert.deepEqual(resolveDetents([0.15, 0.68, 1], VH, 0), [120, 544, 800]);
});

test('★★ детент меньше собственной шапки поднимается до неё', () => {
  // Иначе «15%» на низком экране обрезает заголовок доком, и шит выглядит
  // сломанным, а не маленьким.
  assert.deepEqual(resolveDetents([0.05, 1], VH, HEAD), [HEAD, VH]);
});

test('совпавшие детенты схлопываются — жест не залипает между ними', () => {
  assert.deepEqual(resolveDetents([0.15, 0.15, 1], VH, 0), [120, 800]);
});

test('порядок не зависит от порядка на входе', () => {
  assert.deepEqual(resolveDetents([1, 0.15, 0.68], VH, 0), [120, 544, 800]);
});

test('доли за границами 0..1 зажимаются, мусор отбрасывается', () => {
  assert.deepEqual(resolveDetents([-1, 2], VH, 0), [0, 800]);
  assert.deepEqual(resolveDetents([0.5, NaN, null], VH, 0), [400]);
});

test('вьюпорт ещё не измерен — пустой список, а не NaN-высоты', () => {
  assert.deepEqual(resolveDetents([0.15, 1], 0, 0), []);
});

/* ── Куда сесть после отпускания ─────────────────────────────────────────── */

test('медленная тяга садится на ближайший детент', () => {
  const stops = [120, 544, 800];
  assert.equal(nearestDetent({ stops, height: 130, from: 1 }), 0);
  assert.equal(nearestDetent({ stops, height: 500, from: 0 }), 1);
  assert.equal(nearestDetent({ stops, height: 790, from: 1 }), 2);
});

test('★★ бросок коммитит в свою сторону на один шаг, даже если тяги почти не было', () => {
  // Быстрый короткий свайп обязан сработать — иначе жест ощущается «глухим».
  const stops = [120, 544, 800];
  assert.equal(nearestDetent({ stops, height: 125, from: 0, flick: 1 }), 1);
  assert.equal(nearestDetent({ stops, height: 795, from: 2, flick: -1 }), 1);
});

test('бросок за край списка остаётся на краю', () => {
  const stops = [120, 800];
  assert.equal(nearestDetent({ stops, height: 800, from: 1, flick: 1 }), 1);
  assert.equal(nearestDetent({ stops, height: 120, from: 0, flick: -1 }), 0);
});

test('пустой список детентов не роняет расчёт', () => {
  assert.equal(nearestDetent({ stops: [], height: 100, from: 0 }), 0);
});

test('жест: грип и шапка всегда двигают шит', () => {
  assert.equal(gestureOwner({ onHandle: true, dy: -80, scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), 'drag');
  assert.equal(gestureOwner({ onHandle: true, dy: 80, scrollTop: 200, scrollHeight: 900, clientHeight: 300 }), 'drag');
});

test('жест: тело скроллится на ЛЮБОМ детенте, а не только на верхнем', () => {
  // Ровно тот дефект: на среднем детенте список не скроллился вовсе.
  assert.equal(gestureOwner({ dy: -60, scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), 'scroll');
  assert.equal(gestureOwner({ dy: 60, scrollTop: 120, scrollHeight: 900, clientHeight: 300 }), 'scroll');
});

test('жест: тяга вниз из самого верха опускает шит', () => {
  assert.equal(gestureOwner({ dy: 60, scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), 'drag');
});

test('жест: скроллить нечего — жест достаётся шиту', () => {
  assert.equal(gestureOwner({ dy: -60, scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), 'drag');
  assert.equal(gestureOwner({ dy: -60, scrollTop: 0, scrollHeight: 301, clientHeight: 300 }), 'drag');
});

test('жест: без аргументов — шит (нечего скроллить)', () => {
  assert.equal(gestureOwner(), 'drag');
});

test('жест: пока тащат карточку в содержимом, шит не берёт его вовсе', () => {
  // Иначе перестановка города на телефоне невозможна: шит уезжает вместе с ним.
  assert.equal(gestureOwner({ dragElsewhere: true, dy: 80, scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), 'none');
  // Даже с грипа — тащат уже не шит.
  assert.equal(gestureOwner({ dragElsewhere: true, onHandle: true, dy: -40 }), 'none');
});
