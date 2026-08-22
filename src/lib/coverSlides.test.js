import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCoverSlides } from './coverSlides.js';

const P = ['p1', 'p2', 'p3'];

/* ── Главное: обложка видна ДО ответа каталога ───────────────────────────── */

test('★★ каталог ещё не ответил — в ленте уже есть текущая обложка, а не пустота', () => {
  // Ровно тот дефект, ради которого функция и появилась: пока список был пуст,
  // пикер рисовал слайд «без обложки», и экран открывался фоллбеком.
  assert.deepEqual(composeCoverSlides({ value: 'own', presets: [] }), ['own']);
  assert.deepEqual(composeCoverSlides({ value: 'p2', presets: [] }), ['p2']);
});

test('★★ каталог ответил — пресетная обложка НЕ задвоилась', () => {
  // Вторая половина того же правила: показать сразу нельзя ценой дубля.
  const out = composeCoverSlides({ value: 'p2', presets: P });
  assert.deepEqual(out, P);
  assert.equal(out.filter((u) => u === 'p2').length, 1);
});

test('своя загрузка каталогом не поглощается — остаётся ведущей', () => {
  assert.deepEqual(composeCoverSlides({ value: 'own', presets: P }), ['own', ...P]);
});

/* ── Устойчивость ленты: она не должна «худеть» под пальцем ──────────────── */

test('прежняя своя загрузка остаётся в ленте после выбора пресета', () => {
  // Иначе список схлопывается ровно в тот момент, когда человек в нём листает.
  assert.deepEqual(
    composeCoverSlides({ value: 'p1', extras: ['own'], presets: P }),
    ['own', ...P],
  );
});

test('две свои загрузки: порядок extras сохранён, дублей нет', () => {
  assert.deepEqual(
    composeCoverSlides({ value: 'b', extras: ['b', 'a'], presets: P }),
    ['b', 'a', ...P],
  );
});

/* ── Слайд «без обложки» ─────────────────────────────────────────────────── */

test('blank даёт слайд «без обложки» ПЕРВЫМ и ровно один раз', () => {
  const out = composeCoverSlides({ value: '', blank: true, presets: P });
  assert.deepEqual(out, ['', ...P]);
  assert.equal(out.filter((u) => u === '').length, 1);
});

test('без blank пустого слайда нет, даже когда обложка пуста', () => {
  // Пикер открыли С обложкой — «без обложки» ему предлагать нечего.
  assert.deepEqual(composeCoverSlides({ value: '', presets: P }), P);
});

test('blank переживает приход каталога и остаётся первым', () => {
  assert.deepEqual(composeCoverSlides({ value: 'p3', blank: true, presets: P }), ['', ...P]);
});

/* ── Границы ─────────────────────────────────────────────────────────────── */

test('нет ничего — пустая лента, а не [undefined]', () => {
  assert.deepEqual(composeCoverSlides(), []);
  assert.deepEqual(composeCoverSlides({}), []);
});

test('каталог задаёт порядок пресетов, ведущая группа его не перетасовывает', () => {
  assert.deepEqual(
    composeCoverSlides({ value: 'p3', extras: ['own'], presets: P }),
    ['own', 'p1', 'p2', 'p3'],
  );
});
