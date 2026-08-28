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
 * ТРЕТЬЯ ПРОВЕРКА — СОБЫТИЕ НА СТОРОНЕ ПРИЛОЖЕНИЯ. Первые две смотрят на
 * СОСТОЯНИЕ и обе стоят на стороне зоны: объявить или пометить обязан автор
 * site.css. Но утечка рождается в ДРУГОМ файле и другими руками — правку в
 * app.css пишет тот, кто про зону не думает и site.css не открывает. Сброс из
 * шести объявлений у `.bud-bar` работал, но был БЕЛЫМ СПИСКОМ: седьмое
 * объявление в app.css протекло бы на лендинг молча, и узнать об этом было
 * неоткуда.
 *
 * Уровень СВОЙСТВА тут не годится, и это ЗАМЕРЕНО, а не предположено. «Утечка»
 * и «намеренное наследование» — ОДИН механизм: `.btn{cursor:pointer}` зона
 * получает и радуется, `.bud-bar{height:11px}` — и ломается. Различает их
 * НАМЕРЕНИЕ, а не свойство. Предикат «зона обязана объявить свойство сама либо
 * владеть токеном, через который читается значение» дал 30 «утечек» на восьми
 * общих именах — при том что браузер на всех восьми показывает правильную
 * картинку. Такой гард был бы генератором ложных тревог.
 *
 * Поэтому сторожится СОБЫТИЕ: объявление ДОБАВЛЕНО в правило-одиночку имени,
 * которое носит и разметка зоны. Автор узнаёт в СВОЁМ PR, пока ещё помнит, что
 * делал. Частота замерена по истории: 2 срабатывания на 60 коммитов в app.css —
 * сигнал, а не шум. Осознанно:
 *     /* site-shared-ok: <класс> — <причина> *​/   (в app.css, живёт один PR)
 *
 * Env: BASE_REF (по умолчанию origin/dev). Неразрешимый ref → третья проверка
 * пропускается, первые две работают: они про состояние и базы не требуют.
 * Exit: 0 ok, 1 коллизия/утечка без маркера, 2 внутренняя ошибка.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { SITE_ZONE, assertZonePerimeter } from './zone-perimeter.mjs';
import { join } from 'node:path';

const APP = process.env.APP_CSS_PATH || 'src/design/app.css';
const SITE = process.env.SITE_CSS_PATH || 'public/site.css';
const MARKER = 'site-dup-exempt';
const BASE_MARKER = 'site-base-exempt';
const SHARED_MARKER = 'site-shared-ok';
const BASE_REF = process.env.BASE_REF || 'origin/dev';
// Периметр зоны — ОДИН на все её гарды (`zone-perimeter.mjs`). Здесь он был
// СВОИМ списком из двух путей с пометкой «публичка/логин/join придут своими PR
// Ф6»: они пришли, а список за ними — нет. Прогон с полным периметром сразу дал
// две настоящие утечки в PublicTrip.jsx, не видные три недели.

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

/** Номера строк НОВОГО файла, добавленные этим PR. `--unified=0` даёт голые
 *  хунки, из заголовка `@@ -a,b +c,d @@` берётся диапазон c…c+d-1.
 *
 *  `null` = «посмотреть не смог», и это НЕ то же самое, что «посмотрел, чисто»:
 *  вызывающий печатает пропуск отдельной строкой, а не молчит. Два законных
 *  случая: базы нет (мелкий клон, свежий форк) и файл не под гитом (фикстура
 *  теста подсовывает пути вне репозитория через APP_CSS_PATH). Любой ДРУГОЙ
 *  сбой git — внутренняя ошибка, код 2: гард, который на сбое инструмента
 *  печатает «OK», хуже отсутствующего. */
function addedLines(path) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${BASE_REF}^{commit}`], { stdio: 'ignore' });
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' });
  } catch {
    return null;
  }
  /* ★ ДИФФ ПРОТИВ РАБОЧЕГО ДЕРЕВА, НЕ ПРОТИВ HEAD. Номера строк из диффа
   * сверяются с позициями объявлений, разобранными из ФАЙЛА НА ДИСКЕ. Возьми
   * `BASE_REF...HEAD` — и любая незакоммиченная правка сдвинет строки, а гард
   * сверит номера одного файла с содержимым другого: тихо не то. Поэтому
   * сравнение идёт с ТОЧКОЙ ВЕТВЛЕНИЯ и без второй ревизии — git тогда диффит
   * merge-base против рабочего дерева. Ровно этот урок уже записан у 2p
   * («читает рабочее дерево, не индекс»), и повторять его не надо. */
  let diff;
  try {
    const mergeBase = execFileSync('git', ['merge-base', BASE_REF, 'HEAD'], { encoding: 'utf8' }).trim();
    diff = execFileSync('git', ['diff', '--unified=0', mergeBase, '--', path],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`::error::check-site-primitive-dup: git diff по ${path} не выполнился — ${e.stderr || e.message}`);
    process.exit(2);
  }
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }
  return lines;
}

/** Комментарии → пробелы С СОХРАНЕНИЕМ ДЛИНЫ И ПЕРЕВОДОВ СТРОК. Нужно и то и
 *  другое сразу: фигурная скобка внутри комментария рассинхронизирует брейс-скан
 *  (комментарии этого репозитория цитируют JSX), а сдвиг строк развалил бы
 *  сверку с диффом. Тот же приём и по той же причине, что у гарда 2n. */
function blankComments(css) {
  const out = css.split('');
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] !== '/' || css[i + 1] !== '*') continue;
    const end = css.indexOf('*/', i + 2);
    const stop = end === -1 ? css.length : end + 2;
    for (; i < stop; i += 1) if (css[i] !== '\n') out[i] = ' ';
    i -= 1;
  }
  return out.join('');
}

/** Имена общих классов, чьё правило-одиночку этот PR тронул: номера строк ТЕЛА
 *  правила пересекаются с добавленными.
 *
 *  ★ БЕЗ `postcss` И ВООБЩЕ БЕЗ ЗАВИСИМОСТЕЙ. У джобы `guards` нет `npm ci`, и
 *  это её ЗАЯВЛЕННОЕ свойство: каждый гард там живёт на стандартной библиотеке.
 *  Первая редакция брала postcss ради точных номеров строк и легла в CI с
 *  `ERR_MODULE_NOT_FOUND` — проверять надо не только предикат, но и то, в какой
 *  комнате гард будет жить. Скан тот же, что у `singleClassRules` выше, только
 *  считает ещё и строки.
 *
 *  Гранулярность — ПРАВИЛО, а не объявление: любая добавленная строка внутри
 *  тела значит «PR тронул это правило». Для вопроса «а ты посмотрел на зону?»
 *  это ровно та точность, что нужна. */
function touchedSharedNames(appCss, shared, added) {
  const hit = new Set();
  const blanked = blankComments(appCss);
  for (const m of blanked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const names = m[1].split(',')
      .map((sel) => sel.trim())
      .filter((sel) => /^\.[-\w]+$/.test(sel))
      .map((sel) => sel.slice(1))
      .filter((n) => shared.has(n));
    if (!names.length) continue;
    const bodyAt = m.index + m[1].length + 1;
    const from = blanked.slice(0, bodyAt).split('\n').length;
    const to = from + (m[2].match(/\n/g) || []).length;
    for (let line = from; line <= to; line += 1) {
      if (added.has(line)) { names.forEach((n) => hit.add(n)); break; }
    }
  }
  return hit;
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
  assertZonePerimeter('check-site-primitive-dup');
  const zoneMarkup = markupClasses(SITE_ZONE);
  const leaks = [...zoneMarkup]
    .filter((n) => appNames.has(n) && !siteNames.has(n) && !baseExempt.has(n))
    .sort();

  /* Третья проверка: app.css ДОБАВИЛ объявление имени, которое носит зона. */
  const shared = new Set([...zoneMarkup].filter((n) => appNames.has(n)));
  const added = addedLines(APP);
  let touched = [];
  let touchedAll = [];
  let marked = [];
  if (added && added.size) {
    // Маркер живёт ОДИН PR, поэтому читается из ДОБАВЛЕННЫХ строк app.css, а не
    // из файла целиком: иначе разовое «да, знаю» осталось бы навсегда.
    const addedText = appCss.split('\n').filter((_, i) => added.has(i + 1)).join('\n');
    const ok = new Set();
    for (const m of addedText.matchAll(new RegExp(`${SHARED_MARKER}:\\s*\\.?([-\\w]+)`, 'g'))) ok.add(m[1]);
    touchedAll = [...touchedSharedNames(appCss, shared, added)].sort();
    touched = touchedAll.filter((n) => !ok.has(n));
    marked = touchedAll.filter((n) => ok.has(n));
  }

  if (unmarked.length || leaks.length || touched.length) {
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
    if (touched.length) {
      console.error('::error::check-site-primitive-dup: app.css добавил объявление имени, которое носит и разметка зоны — правка доедет до лендинга');
      for (const n of touched) console.error(`  ✗ .${n}`);
      console.error('  → site.css грузится ПОСЛЕ app.css, но перебивает только то, что объявляет сам.');
      console.error('    Проверь зону: либо она объявляет это свойство, либо значение читается через');
      console.error('    токен, который зона переопределяет на html.site. Иначе величина приедет буквально.');
      console.error(`  → проверил и всё в порядке: /* ${SHARED_MARKER}: <класс> — причина */ в app.css (живёт один PR).`);
    }
    process.exit(1);
  }

  const usedExempt = collisions.filter((n) => exempt.has(n));
  const usedBase = [...zoneMarkup].filter((n) => appNames.has(n) && !siteNames.has(n) && baseExempt.has(n)).sort();
  console.log(`check-site-primitive-dup: ${collisions.length} коллизий site↔app + ${usedBase.length} scoped-покрытых имён разметки, все под маркером — OK`);
  if (usedExempt.length) console.log(`  под ${MARKER}: ${usedExempt.map((n) => `.${n}`).join(' ')}`);
  if (usedBase.length) console.log(`  под ${BASE_MARKER}: ${usedBase.map((n) => `.${n}`).join(' ')}`);
  // «Не смотрел», «смотрел, пусто» и «смотрел, но автор объявил» — три разных
  // исхода, и печатаются они тремя разными словами. Гард, у которого они
  // сливаются в одно «OK», перестаёт быть источником сведений о себе.
  if (added === null) {
    console.log(`  BASE_REF ${BASE_REF} недостижим или app.css вне гита — проверка добавленных объявлений пропущена`);
  } else if (marked.length) {
    console.log(`  общих имён под наблюдением: ${shared.size} · app.css тронул под ${SHARED_MARKER}: ${marked.map((n) => `.${n}`).join(' ')}`);
  } else {
    console.log(`  общих имён под наблюдением: ${shared.size} — app.css ни одного из них в этом PR не трогал`);
  }
  process.exit(0);
}

main();
