// Внутри зоны ссылка на ПЕРЕВЕДЁННУЮ страницу обязана нести язык (TRIP-520).
//
// ЧТО СЛУЧИЛОСЬ. У лендинга и демо есть по три адреса (`/`, `/es`, `/ru`), и
// строит их `zonePath()` — он читает префикс текущего адреса. Обе кнопки
// лендинга через него и шли, а пункт «посмотреть пример» в бургер-меню — нет:
// там стоял голый `DEMO_PATH`. С русского лендинга он уводил на АНГЛИЙСКОЕ
// демо, то есть язык терялся на первом же переходе внутри зоны.
//
// Глазами это не видно: обе ссылки выглядят одинаково, отличается одна обёртка.
// Поэтому инвариант закреплён здесь — разбором исходников, а не сценарием в
// браузере: сценарий проверил бы те ссылки, о которых мы вспомнили, а забытая
// как раз и есть дефект.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = join(ROOT, 'src');

/** Все файлы зоны: сама обвязка и страницы, которые она обслуживает. */
function zoneFiles() {
  const roots = ['components/site', 'pages/Landing', 'pages/Demo', 'pages/Legal.jsx'];
  const out = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) { readdirSync(p).forEach((f) => walk(join(p, f))); return; }
    if (/\.(jsx?|tsx?)$/.test(p) && !p.endsWith('.test.js')) out.push(p);
  };
  roots.forEach((r) => walk(join(SRC, r)));
  return out;
}

test('★ адрес переведённой страницы внутри зоны строится zonePath, а не литералом', () => {
  const offenders = [];
  for (const file of zoneFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
      // Ссылка строится на DEMO_PATH мимо zonePath(...) — тот самый дефект.
      if (!/DEMO_PATH/.test(line)) continue;
      if (/zonePath\(\s*DEMO_PATH\s*\)/.test(line)) continue;
      if (/^\s*(import|export const DEMO_PATH|const DEMO_PATH)/.test(line)) continue;
      // Маршрут в таблице и текст ссылки для показа языка не несут.
      if (/<Route|SHARE_URL|EXACT/.test(line)) continue;
      offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    `ссылка на демо мимо zonePath — язык потеряется на переходе:\n  ${offenders.join('\n  ')}`);
});

test('разбор действительно видит файлы зоны', () => {
  // Без этого предыдущая проверка зеленела бы и на пустом списке файлов.
  const files = zoneFiles().map((f) => relative(ROOT, f));
  assert.ok(files.includes('src/components/site/SiteChrome.jsx'), `обвязка зоны не найдена: ${files.length} файлов`);
  assert.ok(files.some((f) => f.startsWith('src/pages/Landing/')), 'страницы лендинга не найдены');
});
