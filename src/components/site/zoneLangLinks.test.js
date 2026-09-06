// Внутри зоны ссылка на ПЕРЕВЕДЁННУЮ страницу обязана нести язык (TRIP-520).
//
// ЧТО СЛУЧИЛОСЬ. У лендинга и демо есть по три адреса (`/`, `/es`, `/ru`), и
// строит их `useZonePath()` — он читает префикс текущего адреса. Обе кнопки
// лендинга через него и шли, а пункт «посмотреть пример» в бургер-меню — нет:
// там стоял голый `DEMO_PATH`. С русского лендинга он уводил на АНГЛИЙСКОЕ
// демо, то есть язык терялся на первом же переходе внутри зоны.
//
// Глазами это не видно: обе ссылки выглядят одинаково, отличается одна обёртка.
// Поэтому инвариант закреплён здесь — разбором исходников, а не сценарием в
// браузере: сценарий проверил бы те ссылки, о которых мы вспомнили, а забытая
// как раз и есть дефект.
//
// ★ ВТОРАЯ ПОЛОВИНА ИНВАРИАНТА — «АДРЕС ЗОНЫ СЧИТАЕТСЯ В РЕНДЕРЕ». Язык теперь
// меняется БЕЗ перезагрузки документа (переключатель уводит на соседний адрес
// роутером), поэтому любое значение, посчитанное один раз за загрузку, после
// смены остаётся от прежнего языка. Ровно так и сломался `zoneHome()`: он
// кэшировал адрес главной на весь документ (`home ??= …`), и на демо логотип
// после смены языка вёл на прежний.
//
// Мертвее всего эту дыру закрывает НЕ отдельная проверка, а имя: `useZonePath`
// и `useZoneHome` — хуки, и вызвать их вне рендера запрещает штатный
// `react-hooks/rules-of-hooks` в `npm run lint`. Здесь остаётся то, чего он не
// видит: чтение адреса мимо роутера — `window.location.pathname`. Именно оно и
// делало кэш возможным.
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

/** Строки файла без комментариев — разбор смотрит на код, а не на разбор. */
function codeLines(file) {
  return readFileSync(file, 'utf8').split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
}

test('★ адрес переведённой страницы внутри зоны строится useZonePath, а не литералом', () => {
  const offenders = [];
  for (const file of zoneFiles()) {
    for (const [n, line] of codeLines(file)) {
      // Ссылка строится на DEMO_PATH мимо useZonePath(...) — тот самый дефект.
      if (!/DEMO_PATH/.test(line)) continue;
      if (/useZonePath\(\s*DEMO_PATH\s*\)/.test(line)) continue;
      if (/^\s*(import|export const DEMO_PATH|const DEMO_PATH)/.test(line)) continue;
      // Маршрут в таблице и текст ссылки для показа языка не несут.
      if (/<Route|SHARE_URL|EXACT/.test(line)) continue;
      offenders.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    `ссылка на демо мимо useZonePath — язык потеряется на переходе:\n  ${offenders.join('\n  ')}`);
});

test('★★ адрес зоны не читается мимо роутера', () => {
  // `window.location.pathname` не перерисовывает вызывателя и доступен вне
  // рендера — то есть разрешает посчитать адрес один раз на весь документ. Один
  // раз это уже стоило бага (`zoneHome`), поэтому источник закрыт целиком:
  // внутри зоны путь берётся у роутера (`useLocation`).
  const offenders = [];
  for (const file of zoneFiles()) {
    for (const [n, line] of codeLines(file)) {
      if (/window\s*\.\s*location\s*\.\s*pathname/.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `адрес зоны прочитан мимо роутера — значение переживёт смену языка:\n  ${offenders.join('\n  ')}`);
});

test('разбор действительно видит файлы зоны', () => {
  // Без этого предыдущая проверка зеленела бы и на пустом списке файлов.
  const files = zoneFiles().map((f) => relative(ROOT, f));
  assert.ok(files.includes('src/components/site/SiteChrome.jsx'), `обвязка зоны не найдена: ${files.length} файлов`);
  assert.ok(files.some((f) => f.startsWith('src/pages/Landing/')), 'страницы лендинга не найдены');
});
