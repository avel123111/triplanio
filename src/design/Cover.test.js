/**
 * Дрейф-гард примитива <Cover> (TRIP-337).
 *
 * ЗАЧЕМ. Значения 16 обложек-градиентов теперь живут ДВАЖДЫ: как источник данных
 * в `src/lib/trip-gradients.js` (`TRIP_GRADIENTS[N].css`, чем красит трип в БД) и
 * как CSS-правила `.cover[data-cover="gradient_N"]` в `app.css` (чем рисует
 * примитив <Cover> без инлайна). Две копии одного набора расходятся молча —
 * ровно эта конструкция. Здесь они сверяются побайтово: значение в CSS ОБЯЗАНО
 * совпадать с `TRIP_GRADIENTS`, и все 16 обязаны быть и там, и там.
 *
 * Файлы читаются ТЕКСТОМ (не import) — `node --test` не парсит JSX-модули ДС, а
 * нам нужен только текст правил/данных (приём из Layout.test.js/fileType.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GRAD_SRC = readFileSync(fileURLToPath(new URL('../lib/trip-gradients.js', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8');

/** id → css из TRIP_GRADIENTS (по тексту: пара `id: '…'` … `css: '…'`). */
function gradientsFromSource() {
  const map = new Map();
  const re = /id:\s*'(gradient_\d+)'[\s\S]*?css:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(GRAD_SRC))) map.set(m[1], m[2].trim());
  return map;
}

/** id → background из правил `.cover[data-cover="gradient_N"]` в app.css. */
function coverRulesFromCss() {
  const map = new Map();
  const re = /\.cover\[data-cover="(gradient_\d+)"\]\s*\{\s*background:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(CSS))) map.set(m[1], m[2].trim());
  return map;
}

test('★ Cover: 16 обложек-градиентов, и все разобрались из обоих источников', () => {
  const data = gradientsFromSource();
  const css = coverRulesFromCss();
  assert.equal(data.size, 16, `TRIP_GRADIENTS: ожидалось 16, разобрано ${data.size}`);
  assert.equal(css.size, 16, `.cover[data-cover] правил: ожидалось 16, разобрано ${css.size}`);
});

test('★★ Cover: значение каждого .cover[data-cover] == TRIP_GRADIENTS (нет дрейфа CSS↔данные)', () => {
  const data = gradientsFromSource();
  const css = coverRulesFromCss();
  for (const [id, value] of data) {
    assert.ok(css.has(id), `${id} есть в TRIP_GRADIENTS, но нет правила .cover[data-cover="${id}"] в app.css`);
    assert.equal(css.get(id), value, `${id}: CSS-правило разошлось с TRIP_GRADIENTS`);
  }
  for (const id of css.keys()) {
    assert.ok(data.has(id), `.cover[data-cover="${id}"] есть в CSS, но нет в TRIP_GRADIENTS`);
  }
});
