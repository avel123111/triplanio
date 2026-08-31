// Гейт для `routePaths.js` (TRIP-497).
//
// Два разных вопроса, и оба стоят трафика:
//   1. ПРЕДИКАТЫ. «Страница есть» и «адрес ведёт в зону» — не одно и то же, и
//      именно на этом различии стоит `canonical`. Ошибись предикат — и либо
//      каждая опечатка в чужой ссылке просит проиндексировать себя, либо
//      настоящая страница остаётся без canonical. Ни то, ни другое не видно
//      глазами.
//   2. РАСХОЖДЕНИЕ СО СПИСКАМИ. `routePaths.js` перечисляет адреса, которые
//      РИСУЮТСЯ в других файлах. Список, который никто не сверяет с таблицей
//      маршрутов, отстаёт от неё на первой же новой странице — молча. Поэтому
//      таблицы разбираются здесь, а не переписываются от руки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { APP_ROUTES, ZONE_PAGES, isZonePage, isZoneRoute } from './routePaths.js';
import { DEMO_PATH } from '../pages/Demo/demoPath.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Все `<Route path=…>` внутри куска разметки: литералы и `{DEMO_PATH}`. */
function routePathsIn(source) {
  const out = [];
  for (const m of source.matchAll(/<Route\s[^>]*path=(?:"([^"]+)"|\{([A-Z_]+)\})/g)) {
    const literal = m[1];
    if (literal === '*') continue; // фолбэк, не адрес
    out.push(literal ?? (m[2] === 'DEMO_PATH' ? DEMO_PATH : `?${m[2]}`));
  }
  return out;
}

/** Ветка зоны в `App.jsx` — от `if (inZone) {` до её закрывающей скобки. */
function zoneBranch() {
  const src = read('src/App.jsx');
  const start = src.indexOf('if (inZone) {');
  assert.notEqual(start, -1, 'в App.jsx больше нет ветки `if (inZone) {` — тест надо перечитать, а не чинить');
  const end = src.indexOf('\n  }', start);
  assert.notEqual(end, -1, 'не нашёл конец ветки зоны');
  return src.slice(start, end);
}

test('предикаты: страница зоны, адрес зоны и всё остальное', () => {
  // Страницы зоны — и то, и другое.
  for (const p of ['/', DEMO_PATH, '/terms', '/privacy', '/login', '/reset-password']) {
    assert.equal(isZonePage(p), true, `${p} — страница зоны`);
    assert.equal(isZoneRoute(p), true, `${p} — адрес зоны`);
  }

  // ★ Чужой демо-слаг: в зону ведёт (404 должен приехать со стилями сайта), но
  // страницей НЕ является — значит canonical на него не вешается.
  assert.equal(isZoneRoute('/d/opechatka'), true);
  assert.equal(isZonePage('/d/opechatka'), false);

  // Чужой адрес и адрес приложения — ни то, ни другое.
  for (const p of ['/no-such-page', '/trips', '/trip/123', '/settings']) {
    assert.equal(isZoneRoute(p), false, `${p} — не зона`);
    assert.equal(isZonePage(p), false, `${p} — не страница зоны`);
  }
});

test('каждый адрес из sitemap.xml — существующая страница зоны', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.ok(locs.length >= 4, 'карта сайта внезапно опустела');
  for (const path of locs) {
    assert.equal(isZonePage(path), true, `${path} обещан краулеру в sitemap.xml, но страницей зоны не считается`);
  }
});

test('ZONE_PAGES не разошёлся с таблицей маршрутов зоны в App.jsx', () => {
  assert.deepEqual([...routePathsIn(zoneBranch())].sort(), [...ZONE_PAGES].sort());
});

test('APP_ROUTES не разошёлся с таблицей маршрутов в AuthenticatedShell.jsx', () => {
  const shell = routePathsIn(read('src/AuthenticatedShell.jsx'));
  assert.deepEqual([...shell].sort(), [...APP_ROUTES].sort());
});

test('незалогиненный получает вход по каждому маршруту приложения, а не лендинг', () => {
  const src = read('src/App.jsx');
  const start = src.indexOf('if (!isAuthenticated) {');
  assert.notEqual(start, -1);
  const branch = src.slice(start, src.indexOf('\n  }', start));
  // ★ Предикат про СМЫСЛ ветки, а не про её текст: маршруты приложения ведут в
  // <RedirectToLogin>, всё остальное — в 404. Вернись сюда лендинг под `*`, и
  // любая битая ссылка снова станет «страницей» для краулера.
  assert.match(branch, /APP_ROUTES\.map/, 'ветка перестала раскрывать маршруты приложения');
  assert.match(branch, /element=\{<RedirectToLogin \/>\}/, 'адрес приложения без сессии больше не ведёт во вход');
  assert.match(branch, /path="\*" element=\{<PageNotFound \/>\}/, 'чужой адрес больше не отдаёт 404');
  assert.doesNotMatch(branch, /<LandingPage \/>/, 'лендинг вернулся на чужой адрес');
});
