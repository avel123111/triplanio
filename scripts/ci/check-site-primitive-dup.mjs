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
 * Exit: 0 ok, 1 коллизия без маркера, 2 внутренняя ошибка.
 */
import { readFileSync } from 'node:fs';

const APP = process.env.APP_CSS_PATH || 'src/design/app.css';
const SITE = process.env.SITE_CSS_PATH || 'public/site.css';
const MARKER = 'site-dup-exempt';

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
  for (const m of siteCss.matchAll(new RegExp(`${MARKER}:\\s*([-\\w]+)`, 'g'))) {
    exempt.add(m[1]);
  }

  const unmarked = collisions.filter((n) => !exempt.has(n));

  if (unmarked.length) {
    console.error('::error::check-site-primitive-dup: класс объявлен правилом-одиночкой И в site.css, И в app.css — «вторая база» (§1а)');
    for (const n of unmarked) console.error(`  ✗ .${n}`);
    console.error('  → app.css держит это имя правилом-одиночкой. Один объект? зона даёт ТОЛЬКО вариант,');
    console.error('    базу не объявляет. Разные объекты? зона берёт другое имя (расширь семью .section--).');
    console.error(`  → осознанная коллизия: /* ${MARKER}: <класс> — причина */ в site.css.`);
    process.exit(1);
  }

  const usedExempt = collisions.filter((n) => exempt.has(n));
  console.log(`check-site-primitive-dup: ${collisions.length} коллизий site↔app, все под маркером — OK`);
  if (usedExempt.length) console.log(`  под ${MARKER}: ${usedExempt.map((n) => `.${n}`).join(' ')}`);
  process.exit(0);
}

main();
