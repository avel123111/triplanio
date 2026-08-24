#!/usr/bin/env node
/**
 * CI guard 2ae (TRIP-460) — «вторая база» между зоной и приложением.
 *
 * ПОЧЕМУ. Сайтовая зона (public/site.css) и приложение (src/design/app.css)
 * живут на одной странице лендинга: app.css в бандле, site.css — <link> после
 * него. Если ОБА объявляют класс `.X` ПРАВИЛОМ-ОДИНОЧКОЙ (селектор ровно `.X`),
 * поздний site.css перебивает ПЕРЕСЕКАЮЩИЕСЯ свойства — а те, которых у зоны
 * НЕТ, протекают из приложения молча. Так `.sheet` (app: мобильная шторка,
 * max-height:86vh; display:flex) утащил высоту шторки в каждую секцию зоны и
 * накрыл подвал (ревью TRIP-460 §1а). Опасны НЕ пересекающиеся свойства, а
 * недостающие; поэтому мера — САМ ФАКТ двойного объявления, не diff свойств.
 *
 * ПРАВИЛО (§1а). Голое имя класса в site.css допустимо, только если app.css не
 * держит его правилом-одиночкой. Держит — два случая и только два:
 *   • ОДИН объект (кнопка — это кнопка) → зона НЕ объявляет базу, только вариант;
 *   • РАЗНЫЕ объекты (белый лист ≠ шторка) → зона берёт другое имя.
 * Оба разрешает не гард, а автор — маркером с обоснованием в site.css:
 *     /* site-dup-exempt: <класс> — <причина: один объект, зона даёт вариант / …> *​/
 * По образцу check-site-prefixes: коллизия БЕЗ маркера краснит PR; escape живёт
 * в файле (построчный, как orphan-exempt), число коллизий храповит ВНИЗ.
 *
 * ВТОРАЯ ПРОВЕРКА (ревью TRIP-460, п.3 — слепое пятно первой). Первая ловит
 * «объявлено базой в ОБОИХ». Но `.btn`/`.bud-bar` протекли ИНАЧЕ: app.css держит
 * их правилом-одиночкой (геометрия), а site.css НЕ объявлял базу вовсе — только
 * состояние (`.btn:active`) или потомка (`.bud-bar .lbl`). Разметка зоны носит
 * имя, своей базы у зоны нет → геометрия молча течёт из приложения (кнопка
 * приложения вместо пилюли, полоска вместо контейнера строки). Поэтому: класс,
 * который ЕСТЬ В РАЗМЕТКЕ зоны и объявлен базой-одиночкой в app.css, ОБЯЗАН иметь
 * базу-одиночку в site.css — либо явный маркер, что база не нужна (имя покрыто
 * scoped-правилом зоны, `.msg-row .badge`/`.ssheet .err`/`.stat-box .num`):
 *     /* site-base-exempt: <класс> — <причина: покрыт scoped-правилом .x .класс> *​/
 *
 * Exit: 0 ok, 1 коллизия/утечка без маркера, 2 внутренняя ошибка.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.APP_CSS_PATH || 'src/design/app.css';
const SITE = process.env.SITE_CSS_PATH || 'public/site.css';
const MARKER = 'site-dup-exempt';
const BASE_MARKER = 'site-base-exempt';
// Разметка зоны, которая одевается в site.css (не app-DS). Держим синхронно с
// SITE_ZONE в check-site-nav; сюда входят только страницы, ПЕРЕНЕСЁННЫЕ на site.css
// (лендинг + общая обвязка) — публичка/логин/join придут своими PR Ф6.
const ZONE_MARKUP = (process.env.ZONE_MARKUP_DIRS || 'src/pages/Landing,src/components/site').split(',');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Имена классов, объявленных ПРАВИЛОМ-ОДИНОЧКОЙ (селектор ровно `.name`,
 *  один класс без комбинаторов/псевдо/составных). Селектор-список разбирается
 *  по запятой — `.a, .b .c { }` даёт `.a` (одиночка), но не `.b .c`. */
function singleClassRules(css) {
  const names = new Set();
  const noComments = stripComments(css);
  for (const m of noComments.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(',')) {
      const one = sel.trim();
      if (/^\.[-\w]+$/.test(one)) names.add(one.slice(1));
    }
  }
  return names;
}

/** Все .jsx/.js под путём (файл или каталог), рекурсивно. */
function walkFiles(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return /\.(jsx?|tsx?)$/.test(p) ? [p] : [];
  return readdirSync(p).flatMap((e) => walkFiles(join(p, e)));
}

/** Литералы className из разметки зоны (className="a b" и className={`a b`}).
 *  Динамические `${…}` вырезаются — по ним судить нельзя. */
function markupClasses(dirs) {
  const names = new Set();
  for (const d of dirs.flatMap(walkFiles)) {
    const src = readFileSync(d, 'utf8');
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const c of (m[1] || m[2] || '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (/^[a-z][-\w]*$/.test(c)) names.add(c);
      }
    }
  }
  return names;
}

function main() {
  let appCss, siteCss;
  try {
    appCss = readFileSync(APP, 'utf8');
    siteCss = readFileSync(SITE, 'utf8');
  } catch (e) {
    console.error(`check-site-primitive-dup: не читается CSS — ${e.message}`);
    process.exit(2);
  }

  const appNames = singleClassRules(appCss);
  const siteNames = singleClassRules(siteCss);
  const collisions = [...siteNames].filter((n) => appNames.has(n)).sort();

  // Маркеры читаем из site.css С комментариями. Ключ маркера = имя класса.
  const exempt = new Set();
  for (const m of siteCss.matchAll(new RegExp(`${MARKER}:\\s*([-\\w]+)`, 'g'))) exempt.add(m[1]);
  const baseExempt = new Set();
  for (const m of siteCss.matchAll(new RegExp(`${BASE_MARKER}:\\s*([-\\w]+)`, 'g'))) baseExempt.add(m[1]);

  const unmarked = collisions.filter((n) => !exempt.has(n));

  // Вторая проверка: имя из разметки зоны, база-одиночка в app.css, но НЕ в site.css.
  const zoneMarkup = markupClasses(ZONE_MARKUP);
  const leaks = [...zoneMarkup]
    .filter((n) => appNames.has(n) && !siteNames.has(n) && !baseExempt.has(n))
    .sort();

  if (unmarked.length || leaks.length) {
    if (unmarked.length) {
      console.error('::error::check-site-primitive-dup: класс объявлен правилом-одиночкой И в site.css, И в app.css — «вторая база» (§1а)');
      for (const n of unmarked) console.error(`  ✗ .${n}`);
      console.error('  → app.css держит это имя правилом-одиночкой. Один объект? зона даёт ТОЛЬКО вариант,');
      console.error('    базу не объявляет. Разные объекты? зона берёт другое имя (расширь семью .section--).');
      console.error(`  → осознанная коллизия: /* ${MARKER}: <класс> — причина */ в site.css.`);
    }
    if (leaks.length) {
      console.error('::error::check-site-primitive-dup: имя из разметки зоны держит app.css базой-одиночкой, а site.css базы НЕ даёт — геометрия течёт из приложения (ревью TRIP-460 п.3)');
      for (const n of leaks) console.error(`  ✗ .${n}`);
      console.error('  → объяви базу прототипа в site.css (site грузится после app → выиграет) + /* site-dup-exempt */;');
      console.error(`  → либо, если имя покрыто scoped-правилом зоны и база не нужна: /* ${BASE_MARKER}: <класс> — причина */.`);
    }
    process.exit(1);
  }

  const usedExempt = collisions.filter((n) => exempt.has(n));
  const usedBase = [...zoneMarkup].filter((n) => appNames.has(n) && !siteNames.has(n) && baseExempt.has(n)).sort();
  console.log(`check-site-primitive-dup: ${collisions.length} коллизий site↔app + ${usedBase.length} scoped-покрытых имён разметки, все под маркером — OK`);
  if (usedExempt.length) console.log(`  под ${MARKER}: ${usedExempt.map((n) => `.${n}`).join(' ')}`);
  if (usedBase.length) console.log(`  под ${BASE_MARKER}: ${usedBase.map((n) => `.${n}`).join(' ')}`);
  process.exit(0);
}

main();
