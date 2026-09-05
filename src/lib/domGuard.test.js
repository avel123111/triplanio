import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkip, installDomGuard } from './domGuard.js';

// TRIP-515, п.3. Решение гарда — ЧИСТЫЙ предикат, поэтому проверяется без DOM
// (в `node --test` нет Node). Правило репо: гард = код, и он увиден КРАСНЫМ —
// инвертируйте сравнение в shouldSkip, и оба «переусыновлённых» случая станут
// false, тест покраснеет.

test('SKIP, когда опорный узел переусыновлён (принадлежит другому родителю)', () => {
  const a = {};
  const b = {};
  const node = { parentNode: b };
  // Операция вызвана на `a`, но узел живёт под `b` — нативный вызов бросил бы
  // NotFoundError. Гард обязан пропустить и вернуть узел.
  assert.equal(shouldSkip(a, node), true);
});

test('НЕ skip, когда опорный узел действительно наш', () => {
  const a = {};
  const node = { parentNode: a };
  assert.equal(shouldSkip(a, node), false);
});

test('НЕ skip, когда опорного узла нет (append / решает нативный вызов)', () => {
  const a = {};
  assert.equal(shouldSkip(a, null), false);
  assert.equal(shouldSkip(a, undefined), false);
});

// Тонкая установка на Node.prototype: проверяем на минимальном стабе Node, что
// перехват реально спасает от броска и что нормальный путь зовёт оригинал.
// Стаб живёт только на время теста и снимается в finally.
test('установка делает insertBefore на переусыновлённый узел НЕбросающим', () => {
  const realNode = globalThis.Node;
  const insertCalls = [];
  class FakeNode {
    insertBefore(newNode, refNode) {
      insertCalls.push([newNode, refNode]);
      // Как настоящий DOM: если ref не наш ребёнок — бросить.
      if (refNode && refNode.parentNode !== this) {
        throw new Error("NotFoundError: node is not a child of this node");
      }
      return newNode;
    }
    removeChild(child) { return child; }
    replaceChild(n, o) { return o; }
  }
  globalThis.Node = FakeNode;
  try {
    const skipped = [];
    installDomGuard((op) => skipped.push(op));

    const parent = new FakeNode();
    const foreign = { parentNode: new FakeNode() }; // узел под чужим родителем
    const fresh = { tag: 'span' };

    // Без гарда это бросило бы; с гардом — возвращает вставляемый узел.
    let result;
    assert.doesNotThrow(() => { result = parent.insertBefore(fresh, foreign); });
    assert.equal(result, fresh);
    assert.deepEqual(skipped, ['insertBefore'], 'пропуск обязан быть отрепорчен один раз');

    // Нормальный путь (ref — наш ребёнок) зовёт оригинал и не репортит повторно.
    const ours = { parentNode: parent };
    assert.doesNotThrow(() => parent.insertBefore(fresh, ours));
    assert.deepEqual(skipped, ['insertBefore'], 'нормальная вставка не должна репортить');
  } finally {
    if (realNode === undefined) delete globalThis.Node;
    else globalThis.Node = realNode;
  }
});
