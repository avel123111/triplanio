#!/usr/bin/env node
/**
 * CI guard 2ah (TRIP-520) — ССЫЛКА ВНУТРИ ЗОНЫ НЕСЁТ ЯЗЫК СТРАНИЦЫ.
 *
 * ЗАЧЕМ. У лендинга и демо по три адреса — по одному на язык, — и `/` из них
 * не «просто главная», а КАНОНИЧЕСКИЙ АНГЛИЙСКИЙ адрес: `localeOf('/')` = 'en'.
 * Локаль маршрута — ВЕРХНИЙ слой языка (`I18nContext`: `маршрут ?? профиль ??
 * посетитель`), поэтому уход на голый `/` не «оставляет язык как был», а
 * ПЕРЕКЛЮЧАЕТ его на английский. Один литерал `to="/"` стирает и выбор
 * посетителя, и язык профиля:
 *
 *     /es  →  «Начать»  →  /login (испанский)  →  логотип  →  /  (английский)
 *
 * ПОЧЕМУ ГАРД, А НЕ ВНИМАТЕЛЬНОСТЬ. Дефект чинили по одной странице: TRIP-520
 * перевёл на `useZonePath` лендинг, демо, публичку и юр-страницы — и прошёл
 * мимо `AuthShell` (вход и приглашение), единственной оболочки зоны, чей
 * логотип рисует не `SiteChrome`. Именно она и есть самый ходовой выход из
 * зоны. Правило «не забывай про язык» не имеет предиката, поэтому отставание
 * очередного места видно только пользователю — и выглядит как «опять
 * проебался язык», хотя чинили честно.
 *
 * ЧТО ФЛАГИТ. Литеральный адрес ЛОКАЛИЗОВАННОЙ страницы (`LOCALISED_PAGES` —
 * `/` и демо), приехавший в НАВИГАЦИЮ, в файле периметра зоны:
 *   • `to="/"`, `to={'/'}`      — `<Link>`/`<NavLink>` react-router;
 *   • `nav('/')`, `navigate('/')` — императивный переход;
 *   • `to={DEMO_PATH}`, `nav(DEMO_PATH)` — голая константа демо: адрес верный,
 *     язык потерян ровно так же.
 * Правильная форма ОДНА: `useZonePath(path)` (или `useZoneHome()` для лого) —
 * он складывает `routeLocale ?? lang` и приклеивает префикс.
 *
 * ЧЕГО НЕ ФЛАГИТ — названо здесь, чтобы следующий агент не «чинил» верное:
 *   • `/terms`, `/privacy`, `/login`, `/trips` и прочие НЕлокализованные адреса
 *     — у них одна версия, адрес про язык молчит, и язык берётся из слоя i18n;
 *   • любое ВЫРАЖЕНИЕ (`to={home}`, `href={site}`) — статически про него ничего
 *     не известно, а санкционированный строитель именно выражение и даёт;
 *   • `href="/"` на `<a>` — это уже красный по гарду 2ad (перезагрузка теряет
 *     метку кампании), второй раз краснеть не за чем.
 *
 * Периметр — общий `zone-perimeter.mjs`, список локализованных страниц — прямо
 * из `routePaths.js`, то есть у гарда нет своей копии НИ ОДНОГО из двух фактов.
 *
 * Escape: `/* zone-lang-exempt: <path> — причина * /` в том же файле.
 *
 * Инвариант по дереву зоны (не дифф), сосед 2ad. Тест — `check-zone-lang-links.test.mjs`.
 *
 * Exit: 0 ok, 1 нарушение, 2 внутренняя ошибка / зона переехала.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ZONE, assertZonePerimeter } from './zone-perimeter.mjs';
import { LOCALISED_PAGES } from '../../src/lib/routePaths.js';

// Имена констант, под которыми адрес локализованной страницы ездит по коду.
// Голая константа — такой же литерал: значение известно на сборке, языка в нём
// нет. Судим по ИМЕНИ: значение гард не разворачивает, и держать его копию тут
// значило бы завести второй источник правды о том, куда ведёт демо.
const PATH_CONST_NAMES = ['DEMO_PATH'];

/** `to="/"` · `to='/'` · `to={"/"}` · `to={'/'}` — литерал в проп навигации. */
const TO_LITERAL = /\bto\s*=\s*\{?\s*(["'])([^"']*)\1/g;
/** `nav('/')` · `navigate("/")` — литерал в императивном переходе. */
const NAV_LITERAL = /\b(?:nav|navigate)\s*\(\s*(["'])([^"']*)\1/g;
/** `to={DEMO_PATH}` · `nav(DEMO_PATH)` — голая константа адреса. */
const CONST_TARGET = new RegExp(
  `(?:\\bto\\s*=\\s*\\{\\s*|\\b(?:nav|navigate)\\s*\\(\\s*)(${PATH_CONST_NAMES.join('|')})\\s*[,)}]`,
  'g',
);

const EXEMPT = /zone-lang-exempt:\s*(\S+)/g;

/** Гасим комментарии, СОХРАНЯЯ длину и переводы строк: индекс совпадения обязан
 *  и дальше отображаться в номер строки исходника (идиома 2ad). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Исходники зоны. Тесты — мимо: инвариант зоны пинится РАЗБОРОМ исходников
 *  (`zoneLangLinks.test.js`), то есть сломанная форма стоит там нарочно, как
 *  ожидание, а не как ссылка, по которой кто-то уйдёт. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (file) => file.split('\\').join('/');
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

try {
  assertZonePerimeter('check-zone-lang-links');
  if (!LOCALISED_PAGES.length) {
    console.error('::error::2ah: LOCALISED_PAGES пуст — судить нечего, а гард отвечал бы «чисто».');
    process.exit(2);
  }
  const localised = new Set(LOCALISED_PAGES);

  const files = SITE_ZONE.flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p])).map(rel);

  const offenders = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const exempt = new Set([...raw.matchAll(EXEMPT)].map((m) => m[1]));
    const code = stripComments(raw);
    const hit = (idx, shown) => offenders.push({ file: f, line: lineOf(code, idx), shown });

    for (const re of [TO_LITERAL, NAV_LITERAL]) {
      for (const m of code.matchAll(re)) {
        if (!localised.has(m[2]) || exempt.has(m[2])) continue;
        hit(m.index, `"${m[2]}"`);
      }
    }
    for (const m of code.matchAll(CONST_TARGET)) {
      if (exempt.has(m[1])) continue;
      hit(m.index, m[1]);
    }
  }

  if (offenders.length) {
    console.error('::error::2ah zone-lang-links — переход на локализованную страницу без языка (адрес английский, язык сбросится):');
    for (const o of offenders) console.error(`  ✗ ${o.file}:${o.line} — ${o.shown}`);
    console.error('    → адрес строит useZonePath(path) / useZoneHome() (`components/site/zoneCta.js`):');
    console.error('      он складывает routeLocale ?? lang и вешает языковой префикс.');
    console.error('      Осознанный уход именно на английский — /* zone-lang-exempt: <path> — причина */.');
    process.exit(1);
  }

  console.log(`check-zone-lang-links: ${files.length} файлов зоны — переходы на ${LOCALISED_PAGES.join(', ')} несут язык — OK`);
  process.exit(0);
} catch (e) {
  console.error(`::error::check-zone-lang-links internal error: ${e.message}`);
  process.exit(2);
}
