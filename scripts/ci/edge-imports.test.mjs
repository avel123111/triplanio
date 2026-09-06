// Гейт: край не умеет модулей Node, и узнать об этом можно только на выкладке.
//
// ЧТО СЛУЧИЛОСЬ (TRIP-520). `middleware.js` исполняется Edge-функцией и
// импортирует пару наших модулей ради общих констант. В один из них добавили
// `node:fs` — сборка осталась ЗЕЛЁНОЙ, тесты тоже, а выкладка упала уже ПОСЛЕ
// успешной сборки:
//
//   The Edge Function "middleware" is referencing unsupported modules:
//     scripts/build/prerenderPaths.mjs: node:fs, node:url
//
// То есть ограничение не видно ни компилятору, ни линтеру, ни человеку, который
// правит «безобидный» вспомогательный модуль двумя каталогами дальше. Видно оно
// ровно один раз — красной выкладкой.
//
// Поэтому инвариант закреплён здесь: во ВСЁМ графе импортов middleware не должно
// быть ни одного модуля Node. Граф обходится по-настоящему, а не по списку
// файлов: дефект приехал транзитивно, через модуль, который сам middleware не
// упоминает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = resolve(ROOT, 'middleware.js');

/** Спецификаторы модулей из `import ... from '…'` и `import('…')`. */
function importsOf(source) {
  const out = [];
  for (const m of source.matchAll(/(?:^|[\s;])import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/** Весь граф локальных модулей от входа: { файл → [спецификаторы] }. */
function walk(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    const specs = importsOf(readFileSync(file, 'utf8'));
    seen.set(file, specs);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue; // не наш файл — пакет или встроенный
      queue.push(resolve(dirname(file), spec));
    }
  }
  return seen;
}

test('★★ в графе импортов middleware нет ни одного модуля Node', () => {
  const graph = walk(ENTRY);
  assert.ok(graph.size >= 3, 'граф подозрительно мал — разбор импортов сломался, а не дерево');

  const offenders = [];
  for (const [file, specs] of graph) {
    for (const spec of specs) {
      // `node:*` — явная форма; голые `fs`/`path`/… — историческая, тоже не край.
      const bare = ['fs', 'path', 'url', 'crypto', 'os', 'http', 'https', 'stream', 'buffer', 'child_process'];
      if (spec.startsWith('node:') || bare.includes(spec)) {
        offenders.push(`${relative(ROOT, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `край не умеет модулей Node, а они в графе middleware:\n  ${offenders.join('\n  ')}`);
});

test('разбор импортов действительно видит зависимости middleware', () => {
  // Без этой проверки предыдущая зеленела бы и на пустом графе — то есть
  // доказывала бы не то свойство (урок TRIP-460: периметр пинится отдельно).
  const graph = walk(ENTRY);
  const files = [...graph.keys()].map((f) => relative(ROOT, f));
  assert.ok(files.includes('middleware.js'), 'вход не разобран');
  assert.ok(
    files.some((f) => f.startsWith('src/lib/')),
    `граф не дошёл до общих модулей: ${files.join(', ')}`,
  );
  assert.ok(
    files.some((f) => f.startsWith('scripts/build/')),
    `граф не дошёл до модулей сборки, а именно оттуда и приехал дефект: ${files.join(', ')}`,
  );
});
