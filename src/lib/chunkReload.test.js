import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installChunkReloadGuard } from './chunkReload.js';

// Minimal fake browser: capture the listener, count reloads, back sessionStorage
// with a Map. `installChunkReloadGuard` reads bare `window`/`sessionStorage`, which
// resolve to these globals under node.
function fakeEnv() {
  const store = new Map();
  let listener = null;
  let reloads = 0;
  globalThis.window = {
    addEventListener: (name, fn) => { if (name === 'vite:preloadError') listener = fn; },
    location: { reload: () => { reloads += 1; } },
  };
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  return {
    fire() {
      let prevented = false;
      listener?.({ preventDefault: () => { prevented = true; } });
      return prevented;
    },
    reloads: () => reloads,
    teardown() { delete globalThis.window; delete globalThis.sessionStorage; },
  };
}

test('first stale-chunk error reloads once', () => {
  const env = fakeEnv();
  installChunkReloadGuard();
  env.fire();
  assert.equal(env.reloads(), 1);
  env.teardown();
});

// ★ РЕГРЕССИЯ. Раньше сторож звал `preventDefault()`, чтобы Vite «не бросал
// ошибку, которую мы и так лечим перезагрузкой». Для хелпера Vite погашенное
// событие значит «ошибки не было»: он не бросает, `.catch` завершает промис
// УСПЕШНО со значением `undefined`, `React.lazy` считает модуль загруженным и
// читает у `undefined` свойство `.default` — `TypeError: Cannot read properties
// of undefined (reading 'default')` вместо честной ошибки загрузки
// (TRIPLANIO-2V). Гашение события — не деталь, а контракт с загрузчиком.
test('событие НЕ гасится — иначе Vite резолвит модуль в undefined', () => {
  const env = fakeEnv();
  installChunkReloadGuard();
  const prevented = env.fire();
  assert.equal(prevented, false, 'preventDefault() ломает загрузчик: см. комментарий выше');
  env.teardown();
});

// Перезагрузка и гашение — РАЗНЫЕ вещи, и вторая первой не требуется. Пин на
// случай, если кто-то решит, что `preventDefault` нужен, «чтобы reload успел».
test('перезагрузка не зависит от гашения события', () => {
  const env = fakeEnv();
  installChunkReloadGuard();
  const prevented = env.fire();
  assert.equal(env.reloads(), 1);
  assert.equal(prevented, false);
  env.teardown();
});

test('a second error moments later does NOT reload again (no loop)', () => {
  const env = fakeEnv();
  installChunkReloadGuard();
  env.fire();
  env.fire();
  env.fire();
  assert.equal(env.reloads(), 1, 'reload is capped within the window');
  env.teardown();
});

test('no window (node/SSR) is a safe no-op', () => {
  assert.doesNotThrow(() => installChunkReloadGuard());
});
