import { test } from 'node:test';
import assert from 'node:assert/strict';

// `afterPaint` — дверь для фоновой работы (TRIP-520). Проверяем ЕДИНСТВЕННОЕ
// её свойство, ради которого она заведена: работа не начинается ДО `load`.
// Прежняя схема (`requestIdleCallback(cb, { timeout: 2000 })`) этого свойства не
// имела — `timeout` обещает «не позже», а не «не раньше», и на телефоне, где
// простоя в первые секунды нет, дедлайн срабатывал ВСЕГДА, приземляя загрузки в
// окно первой отрисовки.

/** Подменяет глобальный `window`/`document` на время одного вызова. */
async function withDom(readyState, fn) {
  const listeners = {};
  const win = {
    addEventListener: (type, cb) => { (listeners[type] ||= []).push(cb); },
    setTimeout: (cb) => { cb(); return 0; },
  };
  const doc = { readyState };
  globalThis.window = win;
  globalThis.document = doc;
  try {
    const { afterPaint } = await import(`./afterPaint.js?t=${Math.random()}`);
    return await fn({ afterPaint, fire: (type) => (listeners[type] || []).forEach((cb) => cb()) });
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test('до `load` работа НЕ начинается, после — начинается', async () => {
  await withDom('loading', async ({ afterPaint, fire }) => {
    let ran = 0;
    afterPaint(() => { ran += 1; });
    assert.equal(ran, 0, 'страница ещё грузится — фон не тронулся');
    fire('load');
    assert.equal(ran, 1, 'после load работа выполнена');
  });
});

test('на уже загруженной странице работа идёт сразу', async () => {
  await withDom('complete', async ({ afterPaint }) => {
    let ran = 0;
    afterPaint(() => { ran += 1; });
    assert.equal(ran, 1, 'load уже был — ждать нечего');
  });
});
