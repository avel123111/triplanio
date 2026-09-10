#!/usr/bin/env node
/**
 * CI guard 2ah (TRIP-533) — В ЗОНЕ ЕСТЬ ОДНА ДВЕРЬ НАВИГАЦИИ, И НИКТО МИМО НЕЁ
 * НЕ ХОДИТ.
 *
 * ЗАЧЕМ. У лендинга и демо по три адреса, по одному на язык, и `/` из них —
 * КАНОНИЧЕСКИЙ АНГЛИЙСКИЙ (`localeOf('/') === 'en'`). Локаль маршрута — верхний
 * слой языка (`routeLocale ?? profile ?? visitor`), поэтому уход на голый `/`
 * не «сохраняет язык», а переключает его на английский:
 *
 *     /es → «Начать» → /login (испанский) → логотип → / (английский)
 *
 * ★★ ПОЧЕМУ ПРЕДИКАТ ИМЕННО ТАКОЙ — И ПОЧЕМУ ПРЕЖНИЙ БЫЛ ДЫРЯВ ПО ПОСТРОЕНИЮ.
 * Первая редакция этого гарда перечисляла ФОРМЫ ЗАПИСИ адреса (`to="/"`,
 * `to={'/'}`, `nav('/')`, голый `DEMO_PATH`). Перечисление синтаксиса не может
 * быть полным: в этом же дереве уже лежала ссылка `` to={`/${k}`} `` (табы
 * юр-документов), которой оно не видит, а рядом ждали `nav(cond ? '/' : '/x')`
 * и `navigate({ pathname: '/' })`. Гард, чей предикат дырявый, опаснее
 * отсутствующего: он зелёный и его показания принимают за факт — ровно так и
 * прошёл дефект, ради которого писался прежний гейт.
 *
 * Поэтому вопрос сменён с «правильно ли записан адрес» на «МОЖНО ЛИ ВООБЩЕ
 * ЗАПИСАТЬ АДРЕС МИМО ДВЕРИ». Ответ читается одной строкой импорта:
 *
 *   · адрес резолвит `useZoneHref`/`useZonePath` (`components/site/zoneCta.js`)
 *     — он ОДИН решает, нужен ли префикс, по `LOCALISED_PAGES`;
 *   · переход — `useZoneNav()` (там же), ссылка — `<ZoneLink>`
 *     (`components/site/ZoneLink.jsx`);
 *   · значит ВЕСЬ react-router, которым можно уйти на другой адрес
 *     (`Link`, `NavLink`, `Navigate`, `useNavigate`), в зоне импортируют РОВНО
 *     ЭТИ ДВА ФАЙЛА. Все остальные — через дверь, и неправильную ссылку там
 *     нельзя написать.
 *
 * Предикат полный: обойти дверь, не написав импорта, нельзя.
 *
 * ЧЕГО НЕ ФЛАГИТ — названо здесь, чтобы следующий агент не «чинил» верное:
 *   · `useLocation`, `useParams`, `useSearchParams` — ЧТЕНИЕ адреса, уйти по
 *     ним никуда нельзя;
 *   · `<a href>` наружу и якоря — это не роутер (внутренние `<a href>` держит
 *     сосед 2ad);
 *   · `window.location` — не импорт; его половину («адрес зоны не читается мимо
 *     роутера») пинит `zoneLangLinks.test.js`.
 *
 * Периметр — общий `zone-perimeter.mjs`. Имена двери — здесь, и это
 * единственная копия факта во всём гарде; разъехаться с настоящей дверью не
 * даёт `check-zone-lang-links.test.mjs`, который гоняет гард на ЖИВОМ дереве.
 *
 * Escape: `/* zone-nav-exempt: <причина> * /` в файле-нарушителе.
 *
 * Инвариант по дереву зоны (не дифф), сосед 2ad. Exit: 0 ok, 1 нарушение,
 * 2 внутренняя ошибка / зона переехала.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ZONE, assertZonePerimeter } from './zone-perimeter.mjs';

/** Файлы двери: им сырой роутер разрешён, в этом их работа. */
const DOOR = ['src/components/site/zoneCta.js', 'src/components/site/ZoneLink.jsx'];

/** Импорты react-router, которыми можно УЙТИ на другой адрес. */
const NAV_IMPORTS = ['Link', 'NavLink', 'Navigate', 'useNavigate'];

/** `import { … } from 'react-router-dom'` — забираем список имён. */
const RR_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]react-router-dom['"]/g;

const EXEMPT = /zone-nav-exempt:/;

/** Гасим комментарии, СОХРАНЯЯ длину и переводы строк: индекс совпадения обязан
 *  и дальше отображаться в номер строки исходника (идиома 2ad). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

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

  const files = SITE_ZONE.flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p])).map(rel);

  // ★ ДВЕРЬ ОБЯЗАНА СУЩЕСТВОВАТЬ И БЫТЬ В ПЕРИМЕТРЕ. Исчезни она — гард начал бы
  // отвечать «нарушений нет» про зону, в которой двери просто больше нет.
  const missingDoor = DOOR.filter((d) => !files.includes(d));
  if (missingDoor.length) {
    console.error(`::error::2ah: дверь навигации зоны не найдена в периметре: ${missingDoor.join(', ')}`);
    console.error('  Гард судил бы зону, у которой нет двери, и молчал. Переехала дверь — правь DOOR здесь.');
    process.exit(2);
  }

  const offenders = [];
  for (const f of files) {
    if (DOOR.includes(f)) continue;
    const raw = readFileSync(f, 'utf8');
    if (EXEMPT.test(raw)) continue;
    const code = stripComments(raw);
    RR_IMPORT.lastIndex = 0;
    for (const m of code.matchAll(RR_IMPORT)) {
      const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const bad = names.filter((n) => NAV_IMPORTS.includes(n));
      if (bad.length) offenders.push({ file: f, line: lineOf(code, m.index), bad });
    }
  }

  if (offenders.length) {
    console.error('::error::2ah zone-nav — переход зоны мимо двери: адрес соберётся без языка и сбросит его в английский:');
    for (const o of offenders) console.error(`  ✗ ${o.file}:${o.line} — ${o.bad.join(', ')} из react-router-dom`);
    console.error('    → ссылка = <ZoneLink to="…">, переход = useZoneNav(), адрес = useZoneHref().');
    console.error('      Дверь сама решает, нужен ли префикс (LOCALISED_PAGES), поэтому `to` пишется БЕЗ языка.');
    console.error('      Осознанное исключение — /* zone-nav-exempt: <причина> */ в файле.');
    process.exit(1);
  }

  console.log(`check-zone-lang-links: ${files.length} файлов зоны — навигация только через дверь (${DOOR.length} файла) — OK`);
  process.exit(0);
} catch (e) {
  console.error(`::error::check-zone-lang-links internal error: ${e.message}`);
  process.exit(2);
}
