import { test } from 'node:test';
import assert from 'node:assert/strict';

// Что здесь держится (TRIP-478). У экрана запуска нет ни скриншота, ни гарда:
// он снимается СОБЫТИЯМИ, а не значением, поэтому регресс выглядит как
// «всё работает» — заставка уходит, просто на полсекунды раньше, и человек
// получает обратно второе ожидание, ради устранения которого задача и делалась.
// Единственный гейт — этот тест.
//
// Главный случай — ЭСТАФЕТА (последний тест): ожидание переходит между разными
// позициями дерева (словарь → <Suspense> маршрута), React выполняет очистку
// уехавшего раньше эффекта приехавшего, и между ними удержаний ноль. Первая
// версия снимала заставку ровно в эту щель, и на /trips после входа было видно
// два лоудера подряд — splash, затем спиннер загрузки чанка экрана.
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
  return {
    ...mod,
    el,
    // Решение о снятии откладывается на микрозадачу — она встаёт в очередь
    // раньше этого await, поэтому одного тика достаточно.
    tick: () => Promise.resolve(),
    flush: () => { while (timers.length) timers.shift()(); },
    restore: () => { globalThis.document = realDoc; globalThis.setTimeout = realTimeout; },
  };
}

test('готовность приложения не снимает заставку, пока на экране ожидание', async () => {
  const s = await freshSplash('held');
  try {
    s.holdSplash();          // смонтировался <AppLoading>
    s.hideSplash();          // приложение отчиталось о готовности
    await s.tick();
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
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
    assert.equal(s.el.removed, true, 'узел заставки остался в дереве');
  } finally { s.restore(); }
});

test('ожидание, кончившееся ДО отчёта о готовности, заставку не снимает', async () => {
  const s = await freshSplash('early');
  try {
    s.holdSplash()();        // ожидание мелькнуло и ушло
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'ожидание сняло заставку за приложение');
  } finally { s.restore(); }
});

test('без единого ожидания заставку снимает сам отчёт о готовности', async () => {
  const s = await freshSplash('plain');
  try {
    s.hideSplash();
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '');
  } finally { s.restore(); }
});

test('краш снимает заставку мимо удержаний и без отсрочки', async () => {
  const s = await freshSplash('crash');
  try {
    s.holdSplash();          // ожидание уехало вместе с упавшим поддеревом
    s.hideSplash({ crashed: true });
    s.flush();               // без await: экран краха не ждёт микрозадачи
    assert.equal(s.el.attrs['data-out'], '', 'экран краха остался под заставкой');
  } finally { s.restore(); }
});

test('повторные вызовы безвредны', async () => {
  const s = await freshSplash('idempotent');
  try {
    s.hideSplash();
    s.hideSplash();
    await s.tick();
    s.flush();
    s.hideSplash();
    await s.tick();
    s.flush();
    assert.equal(s.el.removed, true);
  } finally { s.restore(); }
});

test('эстафета между двумя ожиданиями одного коммита заставку не роняет', async () => {
  const s = await freshSplash('relay');
  try {
    const dict = s.holdSplash();   // ожидание словаря
    s.hideSplash();                // приложение готово
    // Один коммит React: сперва очистка уехавшего, следом эффект приехавшего.
    dict();
    const route = s.holdSplash();  // <Suspense fallback> маршрута
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], undefined, 'заставка ушла в щель между ожиданиями');

    route();                       // чанк экрана приехал — ожиданий больше нет
    await s.tick();
    s.flush();
    assert.equal(s.el.attrs['data-out'], '', 'заставка не ушла, когда всё готово');
  } finally { s.restore(); }
});
