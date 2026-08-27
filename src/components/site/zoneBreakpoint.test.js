/**
 * Граница зоны — одно число (TRIP-465).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ. Ломается это молча и в полосе шириной в один
 * пиксель: CSS переключает раскладку на своём числе, JS — на своей копии, и
 * если копии разъедутся, на ширине ровно между ними оглавление окажется
 * закрытым там, где кнопки открыть его уже нет. Ни скриншот-диф, ни гарды
 * такого не видят — на 1440 и на 390 всё правильно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ZONE_DESKTOP_MIN, ZONE_DESKTOP_MQ, ZONE_BELOW_DESKTOP_MQ } from './zoneBreakpoint.js';

test('две формы — одно число, и они дополняют друг друга', () => {
  assert.equal(ZONE_DESKTOP_MQ, `(min-width:${ZONE_DESKTOP_MIN}px)`);
  assert.equal(ZONE_BELOW_DESKTOP_MQ, `(max-width:${ZONE_DESKTOP_MIN - 1}px)`);
});

test('★★★ CSS зоны переключается на ТОМ ЖЕ числе, что и JS', () => {
  // Самое дорогое здесь: `site.css` прячет кнопку оглавления начиная с этой
  // ширины, а JS по ней же решает, открывать ли аккордеон. Разъедутся — и
  // между ними появится ширина, где оглавления нет и открыть его нечем.
  const css = readFileSync('public/site.css', 'utf8');
  assert.ok(css.includes(`(min-width:${ZONE_DESKTOP_MIN}px)`),
    `site.css не содержит ${ZONE_DESKTOP_MQ} — JS и CSS разъехались`);
  assert.ok(css.includes(`(max-width:${ZONE_DESKTOP_MIN - 1}px)`),
    `site.css не содержит ${ZONE_BELOW_DESKTOP_MQ} — JS и CSS разъехались`);
  // И у кнопки оглавления граница ровно эта, а не соседняя.
  const desktopBlock = css.slice(css.indexOf(`(min-width:${ZONE_DESKTOP_MIN}px){\n  .doc-toc{`));
  assert.match(desktopBlock.slice(0, 600), /\.doc-toc\s*>\s*summary\s*\{\s*display\s*:\s*none/,
    'на десктопе кнопка оглавления обязана быть спрятана — иначе `open` там не нужен');
});

test('★★ ни один файл зоны не пишет границу литералом', () => {
  // Третья копия числа — это ровно тот способ разъехаться, от которого модуль
  // и заведён. Ищем только В КОДЕ: комментарии объясняют число и имеют право
  // его называть.
  const ZONE = ['src/components/site', 'src/pages/Landing', 'src/pages/Demo',
    'src/pages/Legal.jsx', 'src/pages/PublicTrip.jsx', 'src/pages/Login.jsx', 'src/pages/JoinTrip.jsx'];
  const files = [];
  const walk = (p) => {
    if (statSync(p).isDirectory()) readdirSync(p).forEach((n) => walk(join(p, n)));
    else if (/\.jsx?$/.test(p) && !p.endsWith('.test.js')) files.push(p);
  };
  ZONE.forEach(walk);
  const guilty = [];
  for (const f of files) {
    if (f.endsWith('zoneBreakpoint.js')) continue; // единственный законный дом
    const code = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (new RegExp(`(min|max)-width\\s*:\\s*(${ZONE_DESKTOP_MIN}|${ZONE_DESKTOP_MIN - 1})px`).test(code)) guilty.push(f);
  }
  assert.deepEqual(guilty, [], `граница зоны выписана литералом: ${guilty.join(', ')}`);
});
