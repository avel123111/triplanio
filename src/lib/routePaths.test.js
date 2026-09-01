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

import { APP_ROUTES, GUEST_PLANNER_PATH, ZONE_PAGES, isZonePage, isZoneRoute } from './routePaths.js';
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
  assert.match(branch, /APP_ROUTES[\s\S]{0,120}\.map/, 'ветка перестала раскрывать маршруты приложения');
  assert.match(branch, /element=\{<RedirectToLogin \/>\}/, 'адрес приложения без сессии больше не ведёт во вход');
  assert.match(branch, /path="\*" element=\{<PageNotFound \/>\}/, 'чужой адрес больше не отдаёт 404');
  assert.doesNotMatch(branch, /<LandingPage \/>/, 'лендинг вернулся на чужой адрес');

  // ★ И РОВНО ОДНО ИСКЛЮЧЕНИЕ (TRIP-505). У планировщика без сессии есть СВОЙ
  // экран, а не вход, поэтому он обязан быть вычтен из раскрытия — иначе
  // <RedirectToLogin> объявится вторым обработчиком того же пути и гость молча
  // уедет во вход. Сверяем не текст фильтра, а его СМЫСЛ: адрес назван и
  // исключён.
  assert.match(
    branch,
    /\.filter\([\s\S]{0,80}?!==\s*GUEST_PLANNER_PATH/,
    'планировщик снова раскрывается в редирект во вход — гость до своего экрана не дойдёт',
  );
});

test('гостевой планировщик: свой экран без сессии, вне зоны и после гейта загрузки', () => {
  const src = read('src/App.jsx');

  // 1. Ветка существует и ведёт на планировщик, а не во вход.
  const start = src.indexOf('if (!isAuthenticated && path === GUEST_PLANNER_PATH) {');
  assert.notEqual(start, -1, 'ветка гостевого планировщика исчезла — /new-trip снова уводит во вход');
  const branch = src.slice(start, src.indexOf('\n  }', start));
  assert.match(branch, /<GuestPlanner \/>/, 'ветка перестала рисовать планировщик');

  // 2. ★ ВНЕ `<SiteZone>`. Оболочка зоны подключает site.css, который
  //    переопределяет `.btn` / `.badge` / `.sheet` / `.t-*` приложения и
  //    выигрывает каскад: планировщик внутри неё приедет с чужими кнопками и
  //    типографикой. Глазами в тесте этого не увидеть — поэтому пиним импорт.
  assert.doesNotMatch(branch, /<SiteZone>/, 'планировщик уехал под оболочку зоны — site.css перебьёт дизайн-систему приложения');

  // 3. ★ ПОСЛЕ ГЕЙТА ЗАГРУЗКИ. `isAuthenticated` ложна и у возвращающегося из
  //    OAuth, пока сессия едет; отрисуй мы гостевой вариант в это окно —
  //    черновик записался бы под ключ `guest` уже после входа и разъехался бы
  //    сам с собой. Позиция в файле и есть инвариант.
  const gate = src.indexOf('if (isLoadingPublicSettings || isLoadingAuth) {');
  assert.notEqual(gate, -1, 'гейт загрузки исчез — тест надо перечитать, а не чинить');
  assert.ok(gate < start, 'ветка гостевого планировщика поднялась ВЫШЕ гейта загрузки: возвращающийся из OAuth увидит гостевой вариант');
});

test('адрес гостевого планировщика остаётся маршрутом приложения', () => {
  // Убери его из APP_ROUTES — и `isKnownPath` перестанет его знать, а
  // `middleware.js` начнёт отдавать 404 на живом адресе ДО загрузки приложения.
  assert.ok(APP_ROUTES.includes(GUEST_PLANNER_PATH), 'планировщик выпал из APP_ROUTES — край ответит 404 на живой адрес');
  // И НЕ становится страницей зоны: у него дизайн-система приложения.
  assert.equal(isZonePage(GUEST_PLANNER_PATH), false);
  assert.equal(isZoneRoute(GUEST_PLANNER_PATH), false);
});

test('гостевой планировщик закрыт от индексации в vercel.json', () => {
  // Страница-инструмент без контента вокруг — «тонкая» для краулера, и
  // canonical ей взять неоткуда: его ставит `SiteZone`, а планировщик вне её.
  // Значит единственный честный ответ краулеру — noindex.
  const cfg = JSON.parse(read('vercel.json'));
  const rule = cfg.headers.find((h) => h.source === GUEST_PLANNER_PATH);
  assert.ok(rule, `в vercel.json нет заголовков для ${GUEST_PLANNER_PATH}`);
  assert.deepEqual(
    rule.headers.find((x) => x.key === 'X-Robots-Tag'),
    { key: 'X-Robots-Tag', value: 'noindex' },
    'планировщик открылся краулеру',
  );
});
