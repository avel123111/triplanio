import { test } from 'node:test';
import assert from 'node:assert/strict';

// Что здесь держится (TRIP-478). У экрана запуска нет ни скриншота, ни гарда:
// он снимается СОБЫТИЯМИ, а не значением, поэтому регресс выглядит как
// «всё работает» — заставка уходит, просто на полсекунды раньше, и человек
// получает обратно второе ожидание, ради устранения которого задача и делалась.
// Единственный гейт — этот тест.
//
// Проверяются ровно те три правила, которые легко потерять при правке:
//   1. отчёт приложения о готовности НЕ снимает splash, пока на экране ожидание
//      (<AppLoading> держит его);
//   2. снятие последнего удержания снимает splash — но только если приложение
//      уже отчиталось (иначе ожидание, мелькнувшее раньше готовности, сняло бы
//      заставку за приложение);
//   3. краш снимает заставку мимо удержаний — иначе экран краха остался бы
//      под ней невидимым.
//
// Состояние живёт в модульных переменных, поэтому каждый сценарий берёт СВЕЖИЙ
// модуль (`?case=` — cache-buster для ESM). DOM подставляем руками: узел
// заставки приезжает из index.html, в node его нет.
async function freshSplash(caseId) {
  const el = {
    attrs: /** @type {Record<string, string>} */ ({}),
    removed: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
  };
  const timers = [];
  const realDoc = globalThis.document;
  const realTimeout = globalThis.setTimeout;

  globalThis.document = /** @type {any} */ ({ getElementById: (id) => (id === 'splash' ? el : null) });
  // Таймеры собираем, а не ждём: тест про ПОРЯДОК событий, а не про задержки.
  globalThis.setTimeout = /** @type {any} */ ((fn) => { timers.push(fn); return 0; });

  const mod = await import(`./splash.js?case=${caseId}`);
  const flush = () => { while (timers.length) timers.shift()(); };
  const restore = () => { globalThis.document = realDoc; globalThis.setTimeout = realTimeout; };
  return { ...mod, el, flush, restore };
}

test('готовность приложения не снимает заставку, пока на экране ожидание', async () => {
  const s = await freshSplash('held');
  try {
    s.holdSplash();          // смонтировался <AppLoading>
    s.hideSplash();          // приложение отчиталось о готовности
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'заставка ушла поверх живого ожидания');
  } finally { s.restore(); }
});

test('снятие последнего удержания после отчёта о готовности снимает заставку', async () => {
  const s = await freshSplash('release');
  try {
    const release = s.holdSplash();
    s.hideSplash();
    release();               // <AppLoading> размонтировался
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
    assert.equal(s.el.removed, true, 'узел заставки остался в дереве');
  } finally { s.restore(); }
});

test('ожидание, кончившееся ДО отчёта о готовности, заставку не снимает', async () => {
  const s = await freshSplash('early');
  try {
    s.holdSplash()();        // ожидание мелькнуло и ушло
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'ожидание сняло заставку за приложение');
  } finally { s.restore(); }
});

test('без единого ожидания заставку снимает сам отчёт о готовности', async () => {
  const s = await freshSplash('plain');
  try {
    s.hideSplash();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
  } finally { s.restore(); }
});

test('краш снимает заставку мимо удержаний', async () => {
  const s = await freshSplash('crash');
  try {
    s.holdSplash();          // ожидание уехало вместе с упавшим поддеревом
    s.hideSplash({ crashed: true });
    s.flush();
    assert.equal(s.el.attrs['data-out'], '', 'экран краха остался под заставкой');
  } finally { s.restore(); }
});

test('повторные вызовы безвредны', async () => {
  const s = await freshSplash('idempotent');
  try {
    s.hideSplash();
    s.hideSplash();
    s.flush();
    s.hideSplash();
    s.flush();
    assert.equal(s.el.removed, true);
  } finally { s.restore(); }
});
