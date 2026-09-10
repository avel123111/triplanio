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

import {
  APP_ROUTES, ZONE_PAGES, PRERENDERED_PAGES, LOCALISED_PAGES, PREFIXED_LANGS, DEFAULT_LANG,
  isZonePage, isZoneRoute, isAppRoute, isKnownPath, splitLangPath, withLangPath,
  prerenderedUrls, localeOf, zoneHref, HREFLANG_PAGES,
} from './routePaths.js';
import { LANGUAGES, FALLBACK_LANG } from './i18n/translations.js';
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

test('PREFIXED_LANGS не разошёлся с настоящим списком языков', () => {
  const codes = LANGUAGES.map((l) => l.code);
  for (const lang of PREFIXED_LANGS) {
    assert.ok(codes.includes(lang), `${lang} несёт префикс в адресе, но такого языка в LANGUAGES нет`);
  }
  // ★ Английский обязан остаться БЕЗ префикса: он канонический, и второй его
  // адрес (`/en/`) сделал бы каждую страницу дублем самой себя.
  assert.equal(PREFIXED_LANGS.includes('en'), false, 'английский получил префикс — у страницы стало два адреса');
  // Каждый неанглийский язык обязан БЫТЬ в списке, иначе его страницы не
  // существует вовсе, а переключатель молча ведёт в 404.
  for (const code of codes) {
    if (code !== 'en') assert.ok(PREFIXED_LANGS.includes(code), `язык ${code} есть в LANGUAGES, но адреса у него нет`);
  }
});

test('DEFAULT_LANG не разошёлся с фолбэком языка', () => {
  // Литерал здесь стоит, чтобы `routePaths.js` не импортировал `translations.js`
  // (обратный импорт замкнул бы цикл и закрыл модулю дорогу в edge-middleware).
  // Цена литерала — эта строка: два «английского по умолчанию» обязаны совпасть.
  assert.equal(DEFAULT_LANG, FALLBACK_LANG);
});

test('★★ адрес СТРАНИЦЫ зоны говорит о языке всегда; молчат capability-адреса и приложение', () => {
  // Несущее различие сменилось (TRIP-533). Раньше локаль была у подмножества
  // зоны, и там, где адрес молчал, язык падал на слой устройства — из этого рос
  // весь класс «язык слетает при навигации». Теперь локаль есть у ВСЕГО дерева
  // страниц зоны, и молчат ровно две вещи, и обе по правилу домена:
  //   · одноразовые capability-адреса — язык принадлежит ПОЛУЧАТЕЛЮ ссылки;
  //   · экраны приложения — там авторитет у языка профиля в БД.
  for (const page of LOCALISED_PAGES) {
    assert.equal(localeOf(page), DEFAULT_LANG, `${page}: беспрефиксный адрес — язык по умолчанию`);
    for (const code of PREFIXED_LANGS) {
      assert.equal(localeOf(withLangPath(code, page)), code, `${withLangPath(code, page)}`);
    }
  }
  for (const page of ['/join/abc', '/public/trip/1', '/de']) {
    assert.equal(localeOf(page), null, `${page}: адрес про язык обязан молчать`);
  }
  // ★★ ПРИЛОЖЕНИЕ. Язык там — из профиля (`users.language`), и адрес не имеет
  // права его переутверждать: иначе вошедший с русским профилем открывал бы
  // английский экран, а вернуть как было не умел бы никто.
  for (const pattern of APP_ROUTES) {
    const path = pattern.replace(/:[^/]+/g, 'x');
    assert.equal(localeOf(path), null, `${path}: экран приложения — язык из профиля, адрес молчит`);
    for (const code of PREFIXED_LANGS) {
      assert.equal(isZonePage(withLangPath(code, path)), false, `${withLangPath(code, path)} не существует`);
      assert.equal(isAppRoute(withLangPath(code, path)), false, `${withLangPath(code, path)} не экран приложения`);
      assert.equal(isKnownPath(withLangPath(code, path)), false, `${withLangPath(code, path)} обязан быть 404`);
    }
  }
});

test('разбор и сборка адреса с языком — обратные друг другу', () => {
  assert.deepEqual(splitLangPath('/'), { lang: null, path: '/' });
  assert.deepEqual(splitLangPath('/terms'), { lang: null, path: '/terms' });
  assert.deepEqual(splitLangPath('/es'), { lang: 'es', path: '/' }, 'голый /es — это главная своего языка, а не 404');
  assert.deepEqual(splitLangPath('/es/'), { lang: 'es', path: '/' });
  assert.deepEqual(splitLangPath('/ru/terms'), { lang: 'ru', path: '/terms' });
  assert.deepEqual(splitLangPath(DEMO_PATH), { lang: null, path: DEMO_PATH });
  // Не язык, а просто первый сегмент похожей длины.
  assert.deepEqual(splitLangPath('/en/terms'), { lang: null, path: '/en/terms' }, 'английский префиксом не является');
  assert.deepEqual(splitLangPath('/estonia'), { lang: null, path: '/estonia' });

  for (const path of LOCALISED_PAGES) {
    assert.equal(withLangPath('en', path), path, 'английский адрес обязан остаться без префикса');
    for (const lang of PREFIXED_LANGS) {
      const url = withLangPath(lang, path);
      assert.deepEqual(splitLangPath(url), { lang, path }, `${url} разбирается не в то, из чего собран`);
    }
  }
});

test('под префиксом живёт ВСЯ зона-как-страницы; capability-адреса — нет', () => {
  for (const lang of PREFIXED_LANGS) {
    for (const path of LOCALISED_PAGES) {
      const url = withLangPath(lang, path);
      assert.equal(isZonePage(url), true, `${url} — страница зоны`);
      assert.equal(isZoneRoute(url), true, `${url} — адрес зоны`);
    }
    // ★ Одноразовые capability-адреса языкового адреса НЕ получают: язык такой
    // ссылки принадлежит получателю, а не отправителю (см. LOCALISED_PAGES).
    for (const cap of ['/public/trip/abc', '/join/abc']) {
      assert.equal(isZonePage(`/${lang}${cap}`), false, `/${lang}${cap} не должен существовать`);
      assert.equal(isZoneRoute(`/${lang}${cap}`), false);
    }
    // Чужой демо-слаг под префиксом ведёт в зону (за её 404), но страницей не является.
    assert.equal(isZoneRoute(`/${lang}/d/opechatka`), true);
    assert.equal(isZonePage(`/${lang}/d/opechatka`), false);
  }
});

test('★ hreflang-список — ПОДМНОЖЕСТВО языковых адресов, и он про обещание поиску', () => {
  for (const p of HREFLANG_PAGES) {
    assert.ok(LOCALISED_PAGES.includes(p), `${p} обещан поиску, но языкового адреса у него нет`);
    assert.ok(PRERENDERED_PAGES.includes(p), `${p} обещан поиску, но не печётся`);
  }
  // Юр-документы: языковой адрес ЕСТЬ (обвязка переведена), обещания поиску НЕТ
  // (текст английский по решению TRIP-465 §7) — ровно то различие, ради которого
  // список раздвоен.
  for (const legal of ['/terms', '/privacy']) {
    assert.ok(LOCALISED_PAGES.includes(legal), `${legal}: обвязка переведена — языковой адрес нужен`);
    assert.equal(HREFLANG_PAGES.includes(legal), false, `${legal}: обещать перевод английской прозы нельзя`);
  }
  for (const auth of ['/login', '/reset-password']) {
    assert.ok(LOCALISED_PAGES.includes(auth), `${auth}: переведён, языковой адрес нужен`);
    assert.equal(HREFLANG_PAGES.includes(auth), false, `${auth}: искать его незачем`);
  }
});

test('prerenderedUrls перечисляет каждую испечённую страницу на каждом языке', () => {
  const urls = prerenderedUrls();
  assert.equal(urls.length, PRERENDERED_PAGES.length + HREFLANG_PAGES.length * PREFIXED_LANGS.length);
  // Каждая ОБЕЩАННАЯ ПОИСКУ страница обязана быть в выпечке на каждом языке.
  for (const path of HREFLANG_PAGES) {
    for (const lang of PREFIXED_LANGS) assert.ok(urls.includes(withLangPath(lang, path)), `${path} на ${lang} не печётся`);
  }
  assert.equal(new Set(urls).size, urls.length, 'в списке выпечки есть повтор');
  for (const url of urls) {
    assert.equal(isZonePage(url), true, `${url} печётся, но страницей зоны не считается`);
  }
});

test('sitemap.xml перечисляет РОВНО то, что печёт сборка', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.ok(locs.length >= 4, 'карта сайта внезапно опустела');
  for (const path of locs) {
    assert.equal(isZonePage(path), true, `${path} обещан краулеру в sitemap.xml, но страницей зоны не считается`);
  }
  // ★ Состав, а не только «каждый существует». Карта и выпечка отвечают на один
  // вопрос — «какие у нас есть публичные страницы», — и разойтись им нельзя ни в
  // какую сторону: лишний адрес обещает краулеру то, чего нет, недостающий
  // прячет готовую страницу. Хвостовой слэш нормализуем: `/es/` и `/es` — один
  // адрес (см. `splitLangPath`).
  const norm = (p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  assert.deepEqual(locs.map(norm).sort(), prerenderedUrls().map(norm).sort());
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

/* ─────────────────────────────────────────────────────────────────────────────
 * `zoneHref` — РЕЗОЛВЕР АДРЕСА ЗОНЫ (TRIP-533).
 *
 * Он один решает, нужен ли адресу языковой префикс, и через него проходит КАЖДАЯ
 * ссылка и КАЖДЫЙ переход зоны (дверь `zoneCta.js` + `<ZoneLink>`). Значит его
 * ошибка — это не «одна кривая ссылка», а язык, слетающий на всём сайте, либо
 * 404 на ровном месте. Проверяется ВЫЗОВОМ, а не разбором исходника: прежний
 * гейт этого правила был регуляркой по тексту функции и разъехался с ней молча.
 * ───────────────────────────────────────────────────────────────────────────── */

test('локализованная страница получает префикс своего языка', () => {
  assert.equal(zoneHref('/', 'es'), '/es');
  assert.equal(zoneHref('/', 'ru'), '/ru');
  assert.equal(zoneHref(DEMO_PATH, 'es'), `/es${DEMO_PATH}`);
});

test('★ английский живёт БЕЗ префикса — это адрес, на который ведут все ссылки на нас', () => {
  assert.equal(zoneHref('/', 'en'), '/');
  assert.equal(zoneHref(DEMO_PATH, 'en'), DEMO_PATH);
});

test('★★ НЕлокализованной странице префикс не приклеивается — такого адреса не существует', () => {
  // Именно тут ошибался бы голый `withLangPath`: он вернул бы `/ru/login`,
  // адрес, которого нет ни в одном маршруте (`isZoneRoute` его не знает).
  for (const path of ['/trips', '/settings', '/public/trip/abc', '/join/abc']) {
    assert.equal(zoneHref(path, 'ru'), path, path);
    assert.equal(zoneHref(path, 'es'), path, path);
    assert.equal(isZoneRoute(zoneHref(path, 'ru')) || !isZonePage(path), true, path);
  }
});

test('★★ идемпотентен: адрес можно прогнать через дверь дважды', () => {
  // На этом стоят переключатель языка (резолвит на ЧУЖОЙ язык поверх текущего)
  // и клик по логотипу (адрес приезжает уже с префиксом).
  assert.equal(zoneHref(zoneHref('/', 'es'), 'es'), '/es');
  assert.equal(zoneHref(zoneHref('/', 'es'), 'ru'), '/ru', 'смена языка поверх чужого префикса');
  assert.equal(zoneHref(zoneHref(DEMO_PATH, 'ru'), 'en'), DEMO_PATH, 'возврат на английский снимает префикс');
});

test('★ хвост адреса переживает резолв — в нём якорь и метка кампании', () => {
  assert.equal(zoneHref('/?camp=x#together', 'es'), '/es?camp=x#together');
  assert.equal(zoneHref('/#together', 'ru'), '/ru#together');
  assert.equal(zoneHref('/login?mode=signup', 'ru'), '/ru/login?mode=signup', 'вход теперь тоже имеет языковой адрес');
  assert.equal(zoneHref('/public/trip/abc?t=x', 'ru'), '/public/trip/abc?t=x', 'capability-адрес языка не получает');
  assert.equal(zoneHref('/es?camp=x', 'ru'), '/ru?camp=x', 'хвост не мешает снять чужой префикс');
});

test('каждый испечённый языковой адрес резолвится сам в себя', () => {
  // Связка с выпечкой: если резолвер и карта сайта разойдутся, ссылка внутри
  // сайта поведёт на адрес, которого сборка не печёт.
  for (const url of prerenderedUrls()) {
    const { lang } = splitLangPath(url);
    assert.equal(zoneHref(url, lang ?? DEFAULT_LANG), url, url);
  }
});
