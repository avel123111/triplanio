#!/usr/bin/env node
/**
 * Design-layer audit (TRIP-321).
 *
 * REPORTER, not a gate: it prints the numbers that every TRIP-321 PR has to
 * quote ("families was/now, classes, inline styles"). It exits 0 on any healthy
 * repo. Ф13 turns the family count into a ratchet; until then a wrong number
 * must not be able to fail a PR — but it must not be able to hide either, which
 * is why the measurement lives here in the repo and not in someone's scratchpad.
 * (TRIP-321: the first plan quoted 294 families / 90% spacing coverage; both
 * were eyeballed, and the second one was off by 28 points.)
 *
 * Five sections:
 *   1. FAMILIES  — a class-name prefix is a namespace. 37 heavy families hold
 *      the real work, ~280 tiny ones are one-off noise.
 *   2. INLINE    — `style={{…}}` occurrences (the ratchet itself is guard 2l).
 *   3. SHAPES    — rules grouped by their SET of properties. A shape declared
 *      in 4+ different families is the same object re-invented under a new
 *      name; this is the number the whole unification is aimed at.
 *   4. TOKENS    — names declared in `:root` (the vocabulary guard 2o
 *      ratchets), plus the names that exist only outside it.
 *   4b. ALIASES  — tokens whose value is nothing but `var(--other)`.
 *
 * ── The alias criterion, and why the obvious one is wrong ──
 * The tempting test is "the value is a pure var()". It is wrong three ways, and
 * all three are live in this repo:
 *   • --header-bg  → var(--surface) in :root, var(--bg) in [data-theme=dark].
 *                    A THEME handle. Inlining turns the dark header light.
 *   • --tmk        → var(--brand) on .tmk, var(--warm) on .tmk--finish.
 *                    A STATE handle. Inlining kills the warm finish marker.
 *   • --wash       → var(--surface-2) in app.css :root, but #F7F8FA inside
 *                    login.css `.auth`. login.css is a separate TOKEN ISLAND
 *                    with its own 32 tokens, so the same name resolves to two
 *                    different colours and "substitute the target" repaints
 *                    the auth screen.
 * So the real test is: EVERY definition of the token, anywhere in src/, is
 * `var(--Y)` for the SAME Y. One literal, or two different targets, and it is a
 * handle — a parameter someone re-points on purpose — not a synonym.
 *
 * There is a MIRROR of the same trap, and it is easy to miss because the token
 * itself looks innocent: --X is a clean one-definition alias, but its TARGET
 * --Y is re-pointed further down the tree. `--r-control: var(--r-btn)` is safe
 * only because nothing redefines --r-btn on a component; had login.css `.auth`
 * carried its own --r-btn, every `var(--r-control)` inside the auth screen
 * would change value on substitution. Note the theme case is NOT this trap:
 * `:root` and `:root[data-theme=dark]` match the SAME element, so --X and --Y
 * resolve together there. Only a definition on a DESCENDANT scope (.auth,
 * .btn, .tmk--finish) can split them. Those land in `checkTargets` — a
 * synonym, but one whose call sites must be eyeballed before it collapses.
 *
 * Run: node scripts/ci/audit-design.mjs [--json]
 * Env: AUDIT_ROOT (default `src`) — the tree to scan; the tests point it at a
 *      fixture, which is the only way to exercise the alias classifier on the
 *      three trap shapes without depending on the live stylesheet.
 */
import { readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Parser as AcornParser } from 'acorn';
import acornJsx from 'acorn-jsx';
import postcss from 'postcss';
/** Периметр эпика вынесен в общий модуль: тот же предикат нужен гарду 2q, а два
 *  гарда по одному дереву с РАЗНЫМ периметром молча выдают разные вердикты - это
 *  и случилось (см. шапку `perimeter.mjs`). */
import { OUT_OF_SCOPE, inScope } from './perimeter.mjs';
/** Счёт `apart` — ОДНОЙ функцией на двоих с 2q: два счётчика одного числа уже
 *  разошлись на `apart: { sev: null }` (см. шапку catalog.mjs). */
import { countApart, countAxesFamilies } from './catalog.mjs';

const ROOT = process.env.AUDIT_ROOT || 'src';

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(ROOT);
const cssFiles = files.filter((f) => f.endsWith('.css'));
const jsxFiles = files.filter((f) => /\.(jsx|tsx|js)$/.test(f));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ── 1. Families & classes ───────────────────────────────────────────────────
/** Prefix = the class name up to the first `-`, `--` or `__`. That is the unit a
 *  new namespace is bought in, and the unit guard 2m polices. */
const familyOf = (cls) => cls.replace(/(__|--).*/, '').split('-')[0];

/** A class token can never live inside a quoted string or a `url()`. Without
 *  this, a dot in a PATH is read as a class: `@import './design/fonts.css'`
 *  minted the family `css`, and the @font-face `url('…woff2')` minted `woff2`.
 *  Two namespaces that exist nowhere in the product, sitting in the number that
 *  Ф13 turns into a ratchet — a ratchet you could "improve" by deleting a font,
 *  and whose target you could never reach because two of its units are fiction. */
const stripLiterals = (s) =>
  s.replace(/url\([^)]*\)/g, 'url()').replace(/(['"])(?:\\.|(?!\1)[^\n])*\1/g, '""');

const readCss = (f) => stripLiterals(stripComments(readFileSync(f, 'utf8')));

/** One rule = `selector { declarations }`. Read as `m[1]` / `m[2]` by both the
 *  leading-class walk (1b) and the shape walk (3) — the same rule-splitting must
 *  not be spelled out twice, or one copy silently drifts from the other. */
const rulesOf = (f) => readCss(f).matchAll(/([^{}]+)\{([^{}]*)\}/g);

function classesOf(fileList) {
  const set = new Set();
  for (const f of fileList) {
    for (const m of readCss(f).matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) set.add(m[1]);
  }
  return set;
}

const scopedCss = cssFiles.filter(inScope);
const classes = classesOf(scopedCss);
/** family → the classes it holds. One grouping feeds all three readings: the
 *  headline count, the heavy/tail split, and the namespace/attached/standalone
 *  split in 1b — which needs the members, not just how many there are. */
const families = new Map();
for (const c of classes) {
  const f = familyOf(c);
  if (!families.has(f)) families.set(f, []);
  families.get(f).push(c);
}
const sorted = [...families].map(([f, list]) => [f, list.length]).sort((a, b) => b[1] - a[1]);
const heavy = sorted.filter(([, n]) => n >= 10);
const tail = sorted.filter(([, n]) => n < 10);

// ── 1b. What the 295 is actually made of ────────────────────────────────────
/** THE HEADLINE NUMBER IS THREE DIFFERENT THINGS, and only the first is the
 *  work TRIP-321 is about. Kept as one figure it lies in a specific, expensive
 *  way: renaming `.statbar .k` → `.statbar__k` moves 81 "families" across the
 *  repo without deleting one duplicated shape, and the metric applauds it
 *  exactly as loudly as a real collapse. That is the Ф3b failure mode with a
 *  scoreboard attached — so the split is reported, not the sum alone.
 *
 *    NAMESPACE  — the prefix owns something besides itself (`aa` owns `aa-x`,
 *                 `tile` owns `tile--lg`). This is the pile worth 120 → ~30.
 *    ATTACHED   — a lone name that NEVER leads a selector: `.statbar .k`,
 *                 `.blk.locked`. Nobody bought this namespace; it is a private
 *                 child or a state written without a prefix. Renaming it is
 *                 hygiene with zero visual risk and zero design effect.
 *    STANDALONE — a lone name that leads somewhere: `input`, `select`,
 *                 `checkbox`, `panel`. This is the design system's own
 *                 vocabulary. It must NOT go to zero, and "collapse select
 *                 into input" is not a goal anyone wants. */
const leadingClasses = new Set();
for (const f of scopedCss) {
  for (const m of rulesOf(f)) {
    // Only the LEFTMOST class of each comma-separated selector leads. In
    // `.statbar .k` that is `statbar`; in `.blk.locked` it is `blk`.
    for (const sel of m[1].split(',')) {
      const lead = sel.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/)?.[1];
      if (lead) leadingClasses.add(lead);
    }
  }
}

const familyKinds = {};
for (const [fam, list] of families) {
  if (list.length > 1) familyKinds[fam] = 'namespace';
  else familyKinds[fam] = leadingClasses.has(list[0]) ? 'standalone' : 'attached';
}
const kindCount = (k) => Object.values(familyKinds).filter((v) => v === k).length;
const namespaces = kindCount('namespace');
const singletonsStandalone = kindCount('standalone');
const singletonsAttached = kindCount('attached');
const singletons = singletonsStandalone + singletonsAttached;

// ── 1c. Families that belong to the EXCLUDED perimeter ──────────────────────
/** The scope drops login.css and PublicTrip.css, but the LANDING's rules live
 *  inside app.css. Those families are counted in the target and can never be
 *  worked on, so the goal is understated by however many there are.
 *
 *  A family is filed here only when its markup usage is KNOWN and lands wholly
 *  outside the scope. Silence never counts: a descendant class (`.card > .x`)
 *  carries no className of its own and would be misfiled wholesale.
 *
 *  Usage is read from `className` ONLY. The first cut scanned every quoted
 *  string on the theory that over-broad is the safe direction, and it found
 *  exactly nothing: `nav`, `dur` and `tx` occur as ordinary quoted words in
 *  in-scope files, so every family stayed "in reach" and the section reported
 *  a clean zero it had not earned. Over-broad is not the safe direction here —
 *  it is the direction that produces a confident wrong answer.
 *
 *  ★★ JSX РАЗБИРАЕТСЯ ПАРСЕРОМ, А НЕ РЕГУЛЯРКАМИ. Это не украшение - это вывод
 *  из ТРЁХ ПОДРЯД неверных самодельных разборов, каждый из которых закрывал
 *  одну дыру и открывал следующую, и все три ошибались в одну сторону -
 *  «класс не увиден» или «увидено лишнее», то есть аудит ЗАНИЖАЛ собственный
 *  объём работ:
 *    1. токенизация всего выражения → `className={flag ? "hero" : ""}` писала
 *       ПЕРЕМЕННУЮ `flag` в употребления классов (ревью Codex, PR #659);
 *    2. жадный `[^}]*` при поиске границы `{…}` проглатывал `${`, и у
 *       `` {`cbar${…}`} `` выражение обрывалось на первой `}` - класс `cbar`
 *       терялся вовсе;
 *    3. плоский поиск пар кавычек принимал открывающий backtick ВЛОЖЕННОГО
 *       шаблона за закрывающий у внешнего, а счётчик скобок считал `{` внутри
 *       СТРОКИ структурной и утаскивал в разбор весь остаток файла, после чего
 *       любая последующая обычная строка становилась «классом» (оба - ревью
 *       Codex, PR #661).
 *  Разбор JavaScript регулярками не сходится в принципе: строки, шаблоны,
 *  вложенные шаблоны, комментарии, апострофы в английском тексте и regex-литералы
 *  - всё это грамматика, и лечится она грамматикой. `acorn` + `acorn-jsx` уже
 *  лежат в дереве (приезжают с eslint) и объявлены в devDependencies явно, раз
 *  этот скрипт на них опирается.
 *
 *  Из значения `className` берутся строковые литералы и статические куски
 *  шаблонов - на любой глубине. Код (идентификаторы, вызовы) не берётся; строка,
 *  процитированная ВНУТРИ выражения, берётся - в `` `cbar${x ? ' on' : ''}` ``
 *  класс `on` реально применяется. */
const JsxParser = AcornParser.extend(acornJsx());
const parseFailures = [];

/** ОДИН разбор на файл на весь скрипт. Классы (1c/1d) и доля «собрано из
 *  системы» (1e) читают одно и то же дерево: два разбора одного файла - это два
 *  списка `parseFailures`, которые расходятся ровно в тот день, когда один из
 *  них поменяет опции. */
const astCache = new Map();
const astOf = (f) => {
  if (astCache.has(f)) return astCache.get(f);
  let ast = null;
  try {
    ast = JsxParser.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    // Молча пропустить нельзя: непрочитанный файл выглядит как файл без классов,
    // а это ровно «нечего проверять» и «проверено, чисто» с одинаковым вердиктом.
    parseFailures.push(`${f}: ${e.message}`);
  }
  astCache.set(f, ast);
  return ast;
};

/** Строковые классы из ЗНАЧЕНИЯ `className`, на любой глубине. Вынесено из
 *  `classNameTokens`, потому что тот же разбор нужен §1f (двойное владение
 *  раскладкой): два сборщика одного значения расходятся ровно в тот день,
 *  когда один научится читать новую форму, а второй нет — а §1f и §1c обязаны
 *  отвечать про ОДИН и тот же класс. */
const classStringsInto = (n, add) => {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach((x) => classStringsInto(x, add)); return; }
  if (n.type === 'Literal' && typeof n.value === 'string') add(n.value);
  if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => add(q.value.cooked ?? q.value.raw));
  for (const k of Object.keys(n)) if (k !== 'type') classStringsInto(n[k], add);
};

const classNameTokens = (f) => {
  const out = new Set();
  const add = (s) => { for (const tok of s.split(/\s+/)) if (tok) out.add(tok); };
  const ast = astOf(f);
  if (!ast) return out;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'JSXAttribute' && n.name?.name === 'className') { classStringsInto(n.value, add); return; }
    for (const k of Object.keys(n)) if (k !== 'type') walk(n[k]);
  };
  walk(ast);
  return out;
};
const tokensByFile = new Map(jsxFiles.map((f) => [f, classNameTokens(f)]));
const perimeterFamilies = [...families]
  .filter(([, list]) => {
    const users = jsxFiles.filter((f) => list.some((c) => tokensByFile.get(f).has(c)));
    return users.length > 0 && users.every((f) => !inScope(f));
  })
  .map(([fam]) => fam)
  .sort();
const familiesInReach = families.size - perimeterFamilies.length;
/** The only number the "→ ~30" target can honestly be set against: prefixes
 *  that own descendants AND whose markup this task is allowed to touch. */
const namespacesInReach = Object.entries(familyKinds).filter(
  ([fam, kind]) => kind === 'namespace' && !perimeterFamilies.includes(fam),
).length;

// ── 1d. The catalog: canon vs triage (TRIP-340 PR1) ─────────────────────────
/** ★ THE PREDICATE, IN CODE, BECAUSE OTHERWISE THE NUMBER DOES NOT EXIST
 *  (law 8 of the epic). A family is a CANDIDATE for `canon` when the design
 *  system ITSELF emits one of its classes — read out of `className` in
 *  `src/design/**` and `src/components/ui/**` by the same acorn walk that
 *  everything else here uses.
 *
 *  THE OBVIOUS PREDICATE IS AN INVERSION, AND IT WAS THE ONE IN THE TICKET.
 *  "canon = the DS vocabulary = the 82 standalone singletons" reads plausibly
 *  off the report above and is wrong in BOTH directions, measured on dev @
 *  dc8ebb2:
 *    · of those 82, the DS emits EIGHT (checkbox icon num partner readonly sr
 *      textarea trunc). The other 74 are one-off screen names — `addmini`,
 *      `bookrow`, `cbar`, `mapwrap`, `wmini`, `vpanel` — i.e. the exact pile
 *      the epic exists to remove, filed as the thing it must be measured
 *      against;
 *    · and the actual spine of the system — btn, badge, card, field, tile,
 *      sev, spin, toast, sheet, avatar, dlg, menu, pop, row, t — owns
 *      descendants (`btn--primary`), so it is `namespace`, never `standalone`.
 *      The whole design system would have started life as `triage`.
 *
 *  CANDIDATE, NOT VERDICT. The list this produces is the DRAFT (`--catalog-draft`);
 *  the committed `catalog.json` is what counts, because the machine cannot see
 *  the leakage it contains: `tl3`, `lp`, `rv`, `sb`, `mi` are screen names
 *  hard-coded INSIDE a DS component. They satisfy the predicate and are not
 *  canon — they are a finding for subtask 04 (epic Б5, the zoo inside the DS
 *  itself). A file the review can edit is the point here, unlike a baseline a
 *  ratchet reads: the number that ratchets is `triageClasses`, and every status
 *  change is one line in the diff. */
const DESIGN_SOURCE = /(^|\/)(design|components\/ui)\//;
const designFamilies = new Set();
for (const f of jsxFiles) {
  if (!DESIGN_SOURCE.test(f)) continue;
  for (const tok of tokensByFile.get(f)) {
    const fam = familyOf(tok);
    if (families.has(fam)) designFamilies.add(fam);
  }
}

/** The committed catalog. ABSENT is a legal state exactly once — on the PR that
 *  introduces it, where the BASE side has no file yet — and it reports `null`,
 *  never 0 and never "everything is triage". Guard 2o turns `null` on HEAD into
 *  a red and `null` on the base into "floor established by this PR", so
 *  "nothing to check" and "checked, clean" cannot print the same verdict.
 *
 *  UNREADABLE is NOT absent. A syntax error in the file must not degrade into
 *  "no catalog" — that would make deleting a brace a way to switch the fifth
 *  metric off. It is reported as `catalogError` and 2o dies on it. */
const CATALOG_PATH = join(ROOT, 'design', 'catalog.json');
const STATUSES = new Set(['canon', 'triage']);
let catalogStatuses = null;
let catalogError = null;
/** ★ 7-е число (TRIP-364 PR-I): записи `apart` — обличья, объявленные вне осей.
 *  До этого apart НЕ ХРАПОВИЛСЯ НИЧЕМ: он живёт внутри гарда 2q, а пол про него
 *  не знал. То есть любое уникальное исполнение клалось туда с красивой
 *  причиной, и ни одно число не краснело — дверь ровно того класса, ради
 *  закрытия которого написан пол. Своя шапка каталога обещает про этот список
 *  «видим в диффе, печатается числом и ОБЯЗАН ПУСТЕТЬ» — обещание без храповика
 *  и есть та самая непроверяемая строка.
 *  `null`, а не 0, когда каталога нет: иначе «файла нет» и «список пуст» дают
 *  одно число, а 2o обязан их различать (та же дисциплина, что у пятой). */
let apartEntries = null;
/** ★ 8-е число (TRIP-364 PR-I): семьи, объявившие оси. ТОЛЬКО ВВЕРХ - против
 *  дыры в седьмом: apart понижается ДЕ-ДЕКЛАРАЦИЕЙ. Убери семью из axes вместе с
 *  её записями в apart - apart упадёт, а оба гарда останутся зелёными, потому
 *  что семья без ключа в axes не проверяется 2q вовсе. Число понижалось бы
 *  изменением того, ЧТО ОНО СЧИТАЕТ. */
let axesFamilies = null;
try {
  const parsed = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  // `families: null` passes `typeof … === 'object'` and would otherwise read as
  // "no catalog" — i.e. the malformed file switching the metric off, which is
  // the one thing the paragraph above says it must not be able to do.
  if (!parsed?.families || typeof parsed.families !== 'object' || Array.isArray(parsed.families)) {
    catalogError = `${CATALOG_PATH}: expected an object under "families"`;
  } else {
    catalogStatuses = parsed.families;
    // Отсутствующий `apart` — законный ноль (семьи есть, исключений нет), а вот
    // ЧИТАЕМЫЙ каталог с кривым `apart` — ошибка, а не «ноль исключений»:
    // иначе список гасится опечаткой ровно так же, как пятая метрика скобкой.
    const ap = parsed.apart;
    if (ap === undefined || ap === null) apartEntries = 0;
    else if (typeof ap !== 'object' || Array.isArray(ap)) catalogError = `${CATALOG_PATH}: expected an object under "apart"`;
    else apartEntries = countApart(ap);
    axesFamilies = countAxesFamilies(parsed.axes);
  }
} catch (e) {
  if (e.code !== 'ENOENT') catalogError = `${CATALOG_PATH}: ${e.message}`;
}

/** Three ways the catalog can stop describing the tree, and all three make
 *  `triageClasses` a number that measured something other than what it says:
 *    MISSING — a family exists and is not filed → its classes are counted
 *              nowhere, so the metric silently UNDERSTATES the work left;
 *    STALE   — a family is filed and no longer exists → a line nobody will ever
 *              clean up, and the "→ canon" progress it implies is fiction;
 *    INVALID — a typo in the status (`"canonn"`) is NOT triage, so the number
 *              DROPS. That looks like progress and is the epic's signature
 *              failure mode transposed once more: improve the number you watch
 *              by changing what it counts. */
// `hasOwn`, not `in`: `.constructor` is a legal class name, and an inherited key
// would read as "filed" while contributing nothing to the count — unfiled has to
// stay loud, that is the whole job of this list.
const catalogMissing = catalogStatuses
  ? [...families.keys()].filter((f) => !Object.hasOwn(catalogStatuses, f)).sort()
  : [];
const catalogStale = catalogStatuses ? Object.keys(catalogStatuses).filter((f) => !families.has(f)).sort() : [];
const catalogInvalid = catalogStatuses
  ? Object.entries(catalogStatuses)
      .filter(([, v]) => !STATUSES.has(v))
      .map(([f, v]) => `${f}: ${JSON.stringify(v)}`)
      .sort()
  : [];

/** ★ STATUS ON THE FAMILY, COUNT ON THE CLASSES — and the two are different on
 *  purpose. The family is the unit a namespace is bought in (what guard 2m
 *  polices, what the epic's "124 → ~30" targets), so that is what carries a
 *  verdict. But ratcheting the FAMILY count would stall on the correct move:
 *  renaming `.bgt-row` onto `.row` empties a family long before it disappears,
 *  and until the last class leaves, a family-level ratchet sees nothing. On
 *  classes the same move reads `-1` immediately. */
const triageClasses = catalogStatuses
  ? [...families].reduce((n, [fam, list]) => n + (catalogStatuses[fam] === 'triage' ? list.length : 0), 0)
  : null;

// ── 1e. Приложение собрано из системы (TRIP-337 §1 · ГЛАВНОЕ ЧИСЛО ЭПИКА) ───
/** ★ «Классов ≤500» снято решением Pavel 2026-08-07: 500 было взято как
 *  «примерно столько в нормальных приложениях» и здоровья системы не мерило -
 *  прийти к 500 и остаться с зоопарком можно. Здоровье - это ЭКРАНЫ, СОБРАННЫЕ
 *  ИЗ СИСТЕМЫ и почти ничего не рисующие сами. Вот это число.
 *
 *  ── ТРИ ОСИ, И ОНИ ДАЮТ РАЗБРОС 16-23% НА ОДНОМ ДЕРЕВЕ ──
 *  Замеры на `dev @ 2a753a2`, все шесть воспроизводятся:
 *
 *    периметр \ знаменатель        листья разметки     + композиция и вендор
 *    всё src (внутренности ДС)      811/4177 = 19.4%     811/5016 = 16.2%
 *    без внутренностей ДС           808/3977 = 20.3%     808/4746 = 17.0%
 *    ещё минус лендинг/вход         806/3492 = 23.1%     806/4201 = 19.2%
 *
 *  Ручная ревизия эпика дала 17% (правая колонка средней строки, 4328
 *  элементов против моих 4746), прежний диагноз TRIP-321 - 5.7% по третьему
 *  предикату. Никто не ошибался: «элемент интерфейса» не был определён. Ниже -
 *  определение, и число печатает оно.
 *
 *  Таблица - сверка ОСЕЙ и снята до того, как предикат дописали; шипнутое число
 *  берётся из нижней правой ячейки МИНУС восемь элементов: 5 нерендерящих тегов
 *  (`style`/`script`/`noscript`) и 3 составных имени (`<theme.Icon/>` и родня,
 *  см. `elementKind`). На том же `2a753a2` код печатает 806/3484 = 23.13%.
 *
 *  ── ЧИСЛИТЕЛЬ ──
 *  Элемент, чьё имя импортировано из `<ROOT>/design/**`.
 *
 *  ── ЗНАМЕНАТЕЛЬ = ЛИСТЬЯ РАЗМЕТКИ ──
 *  Числитель + сырые host-теги + элементы из `<ROOT>/components/ui/**`.
 *  Легаси-слой шадсн стоит в ЗНАМЕНАТЕЛЕ намеренно: DoD (a) требует его нуля,
 *  значит переезд `ui → design` обязан долю ПОДНИМАТЬ, а не оставлять на месте.
 *
 *  ── ЧТО НЕ СЧИТАЕТСЯ ВООБЩЕ, И ПОЧЕМУ ИМЕННО ТАК ──
 *  · СВОЯ КОМПОЗИЦИЯ (`<MembersLens/>`, компонент, объявленный в этом же файле)
 *    и ВЕНДОР (`lucide`, `Route`, провайдеры). Иначе метрика краснеет на
 *    ПРАВИЛЬНОМ ходе: разбиение экрана на подкомпоненты - это фаза 09, а каждый
 *    новый `<CityRow/>` в разметке опускал бы долю. Красный на правильном ходе
 *    = выключенный гард (урок 2p). Внутренности такого компонента считаются
 *    ТАМ, ГДЕ ОБЪЯВЛЕНЫ, поэтому спрятать разметку за своим именем нельзя.
 *  · ПОТРОХА `<svg>` - графика, заменить примитивом нечего.
 *  · Нерендерящие теги (`style`, `script`, `noscript`) и фрагменты.
 *
 *  ── ПЕРИМЕТР ──
 *  `inScope` - тот же, что у классов и семейств, - ПЛЮС исключены внутренности
 *  самой ДС (`design/**`, `components/ui/**`).
 *
 *  ★★ ВТОРОЕ ИСКЛЮЧЕНИЕ И ЕСТЬ ГЛАВНАЯ ЛОВУШКА ПРЕДИКАТА: `Btn` внутри собран
 *  из `<button>`, `Card` из `<div>` - это система, а не долг. С потрохами ДС в
 *  знаменателе 100% недостижимы ПО ПОСТРОЕНИЮ, а каждый новый примитив
 *  УХУДШАЕТ число, то есть метрика штрафует ровно ту работу, ради которой
 *  заведена. Тот же класс ошибки, что «канон = 82 синглтона» (§1d), только на
 *  другой оси.
 *
 *  ── ГРАНИЦЫ, НАЗВАННЫЕ ВСЛУХ (то, чего это число НЕ видит) ──
 *  1. ЛОКАЛЬНЫЙ ШИМ. Рукописный `<Label>` с 41 вызовом виден как ОДИН сырой
 *     `<label>` в месте объявления. Это прямая цена границы «своя композиция не
 *     считается», поэтому шимы с именем, которое ДС уже экспортирует,
 *     ПЕЧАТАЮТСЯ отдельным списком - дыра названа, а не выведена из числа.
 *  2. СВАЛИТЬ РАЗМЕТКУ ЭКРАНА В `design/**` = поднять долю без работы. Это
 *     стоит строки диффа и ломается о каталог (2o напечатает переклейку), но
 *     дополнительно печатается `implHost` - сырые теги внутри самой ДС.
 *  3. Динамический `import()` и ре-экспорт через промежуточный модуль читаются
 *     как своя композиция, а не как ДС: ошибка в БЕЗОПАСНУЮ сторону (доля
 *     занижена, ход всё равно засчитается через прямой импорт).
 *  4. РАЗМЕТКА ЭКРАНА ВХОДА В ЧИСЛЕ ЕСТЬ, хотя §10 держит его вне периметра до
 *     подзадачи 10: `OUT_OF_SCOPE` называет `login.css`, а компонент - это
 *     `Login.jsx`, и он под предикат не подпадает. Правится это НЕ здесь:
 *     трогать общий предиката периметра ради одной метрики - завести вторую
 *     линейку. Цена названа: 203 сырых тега заморожены до 10, то есть число
 *     ПЕССИМИСТИЧНО ровно на них. */
const DS_MODULE = /(^|\/)design(\/|$)/;
const UI_MODULE = /(^|\/)components\/ui(\/|$)/;
const NON_RENDERING = new Set(['style', 'script', 'noscript']);

/** `@/x` - алиас на корень скана (в репозитории это `src/`), относительный путь
 *  - от каталога файла, голый спецификатор - вендор (`null`). Резолвится ПУТЬ, а
 *  не имя пакета: предикат «строка содержит design» ловил бы `@/lib/design-tokens`. */
const importTarget = (file, spec) => {
  if (spec.startsWith('@/')) return join(ROOT, spec.slice(2));
  if (spec.startsWith('.')) return join(dirname(file), spec);
  return null;
};

/** Имена, которые ДС экспортирует. Нужны ровно для одного - назвать локальный
 *  шим (`const Input = …` при живом `Input` из ДС). Дефолтный экспорт читается
 *  ТОЖЕ: `export default Icon` - единственная форма в `design/icons.jsx`, и без
 *  неё список шимов молчал бы ровно про те компоненты, у которых имени в
 *  `export {…}` нет, то есть называл бы дыру неполно. Анонимный
 *  (`export default () => …`) имени не даёт и не добавляется. */
/** Имена, экспортированные ОДНИМ модулем. Вынесено из сборщика `dsExports`,
 *  потому что тот же вопрос задаёт §1f про `Layout.jsx`, а свой урезанный
 *  сборщик рядом с полным - это дыра, которая уже случилась: первая редакция
 *  §1f читала только `export const X`, и рефактор примитивов в
 *  `const Row = …; export { Row }` МОЛЧА выключал измерение (ревью Codex,
 *  P2). Формы: объявление в `export`, `export function/class`, `export {…}`
 *  и именованный `export default`. */
const exportedNames = (ast) => {
  const out = new Set();
  for (const n of ast.body) {
    if (n.type === 'ExportDefaultDeclaration') {
      const d = n.declaration;
      if (d.type === 'Identifier') out.add(d.name);
      else if (d.id?.name) out.add(d.id.name);
      continue;
    }
    if (n.type !== 'ExportNamedDeclaration') continue;
    if (n.declaration?.type === 'VariableDeclaration') {
      for (const d of n.declaration.declarations) if (d.id?.name) out.add(d.id.name);
    } else if (n.declaration?.id?.name) out.add(n.declaration.id.name);
    for (const s of n.specifiers ?? []) if (s.exported?.name) out.add(s.exported.name);
  }
  return out;
};

const dsExports = new Set();
for (const f of jsxFiles) {
  if (!DS_MODULE.test(f)) continue;
  const ast = astOf(f);
  if (!ast) continue;
  for (const name of exportedNames(ast)) dsExports.add(name);
}

const dsShare = {
  ds: 0, ui: 0, host: 0, app: 0, local: 0, vendor: 0, svg: 0, nonRendering: 0, implHost: 0,
  denominator: 0, byFile: [], shims: [], byTag: [], byComponent: [],
};

/** ★ §1f · ИМЕНА ПРИМИТИВОВ РАСКЛАДКИ ЧИТАЮТСЯ ИЗ САМОГО МОДУЛЯ, а не
 *  переписываются сюда списком: шестой примитив, заведённый когда-нибудь в
 *  `Layout.jsx`, обязан попасть под замер в тот же день, а не в день, когда
 *  кто-то вспомнит про эту строку. Ровно поэтому оси берутся из каталога, а не
 *  из головы (TRIP-388, апрув 1).
 *
 *  `null` = модуля нет (так выглядит база ДО TRIP-388 и фикстура без него).
 *  Это НЕ ноль: «нечего мерить» и «померено, чисто» не должны печатать
 *  одинаковый вердикт — правило, которым уже поймана дыра в 2l. */
const LAYOUT_PRIMITIVES_FILE = join(ROOT, 'design', 'Layout.jsx');
const layoutPrimitiveNames = jsxFiles.includes(LAYOUT_PRIMITIVES_FILE)
  ? (() => {
      const ast = astOf(LAYOUT_PRIMITIVES_FILE);
      if (!ast) return null;
      const out = exportedNames(ast);
      return out.size ? out : null;
    })()
  : null;

/** ★★ ДВЕ ДВЕРИ, ПОТОМУ ЧТО ИХ РЕАЛЬНО ДВЕ. Через баррель (`from '@/design'`)
 *  файл-источник неизвестен, и спросить можно только ИМЯ; напрямую
 *  (`from '@/design/Layout'`) имя не нужно вовсе — примитив тот, кто приехал ИЗ
 *  ЭТОГО ФАЙЛА, как бы его ни назвали на месте.
 *
 *  Именная дверь дала ТРИ тихих пропуска подряд (все три - ревью Codex, P2, и
 *  все три воспроизведены прогоном): алиас `Row as Stack`, форма экспорта
 *  `export {…}`, переименованный ДЕФОЛТНЫЙ импорт `import Stack from
 *  '…/Layout'`. Общее у них одно - измеритель отвечал «чисто» над
 *  непроверенным местом, ничего не печатая. Файловая дверь закрывает весь этот
 *  класс разом: она не про то, как имя написано. */
const noExt = (p) => p.replace(/\.(jsx|tsx|js|ts)$/, '');
const LAYOUT_PRIMITIVES_SPEC = noExt(LAYOUT_PRIMITIVES_FILE);

/** Узлы-примитивы, которым экран передал СВОЙ класс. Пересечение с приватными
 *  классами раскладки считается ниже — там, где те уже собраны из CSS. */
const layoutPrimitiveUses = [];
const classNameValueOf = (node) =>
  node.openingElement.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name?.name === 'className',
  )?.value ?? null;

/** ★ РАЗБИВКА ПО ТЕГУ - ЭТО НЕ УКРАШЕНИЕ ОТЧЁТА, А ТО, ЧЕМ РЕШАЕТСЯ ПОРЯДОК ФАЗ.
 *  Доля двигается ровно одним способом: сырой тег стал компонентом ДС. Тогда
 *  элемент уезжает из `host` в `ds`, знаменатель НЕ меняется, и вклад тега
 *  считается арифметикой: `Δ п.п. = 100 * n / знаменатель`. Отсюда видно, что
 *  фаза, переносящая ПРАВИЛА между классами (05, 06), это число не двигает
 *  вообще - `div` с новым классом остаётся `div`, - а фаза компонентов (07)
 *  двигает сразу и много. Печатается, чтобы такой довод предъявлялся числом. */
const byTag = new Map();
const byComponent = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

/** `<div/>` → `{base:'div'}`; `<Dialog.Title/>` → `{base:'Dialog', member:true}`
 *  (импортом связан КОРЕНЬ, `Title` - его поле); `<svg:path/>` → `{base:'path'}`. */
const elementName = (node) => {
  const n = node.openingElement.name;
  if (n.type === 'JSXMemberExpression') {
    let o = n.object;
    while (o.type === 'JSXMemberExpression') o = o.object;
    return { base: o.name ?? '', member: true };
  }
  // JSXIdentifier - имя целиком; JSXNamespacedName (`<svg:path/>`) - его local-часть.
  return { base: (n.type === 'JSXIdentifier' ? n.name : n.name?.name) ?? '', member: false };
};

/** Элемент → куча.
 *
 *  ★ РЕГИСТР РЕШАЕТ ТОЛЬКО У ОДНОСЛОВНОГО ИМЕНИ. По грамматике JSX составное имя
 *  - ВСЕГДА компонент, каким бы ни был регистр корня: `<motion.div/>`,
 *  `<theme.Icon/>`, `<d.Icon/>` (все три живые в src) - это не сырые теги. Без
 *  `member` они падали в `host`, то есть в ЗНАМЕНАТЕЛЬ, и метрика утверждала
 *  «экран нарисовал это сам». Хуже направление ошибки: при
 *  `import * as ds from '@/design'` вызов `<ds.Btn/>` тоже читался как сырой тег
 *  - метрика штрафовала бы ровно ту работу, ради которой заведена (тот же класс
 *  ошибки, что «внутренности ДС в знаменателе», только на оси имени). */
const elementKind = ({ base, member }, imports) => {
  if (!member && !/^[A-Z]/.test(base)) return NON_RENDERING.has(base) ? 'nonRendering' : 'host';
  if (!imports.has(base)) return 'local';
  const target = imports.get(base);
  if (target === null) return 'vendor';
  if (DS_MODULE.test(target)) return 'ds';
  if (UI_MODULE.test(target)) return 'ui';
  return 'app';
};

for (const f of jsxFiles) {
  const impl = DESIGN_SOURCE.test(f);
  if (!impl && !inScope(f)) continue;
  const ast = astOf(f);
  if (!ast) continue;

  const imports = new Map();
  /** ЛОКАЛЬНОЕ имя → ЭКСПОРТИРОВАННОЕ. Нужно §1f: под алиасом
   *  (`import { Row as Stack }`) в разметке стоит `Stack`, и проверка по имени
   *  тега пропускает узел, который рисует `Row`; обратный алиас
   *  (`import { Btn as Row }`) даёт ЛОЖНОЕ срабатывание. `imports` хранит
   *  только путь модуля и на этот вопрос не отвечает (ревью Codex, P2). */
  const importedAs = new Map();
  /** Локальные имена, приехавшие ПРЯМО из модуля примитивов — вторая дверь §1f
   *  (см. «ДВЕ ДВЕРИ»). Имя тут не спрашивается вообще. */
  const fromLayoutModule = new Set();
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue;
    const target = importTarget(f, n.source.value);
    const isLayoutModule = target !== null && noExt(target) === LAYOUT_PRIMITIVES_SPEC;
    for (const s of n.specifiers) {
      imports.set(s.local.name, target);
      if (s.type === 'ImportSpecifier' && s.imported?.name) importedAs.set(s.local.name, s.imported.name);
      // Пространство имён (`import * as L`) сюда НЕ идёт: обращение к нему -
      // `<L.Row>`, то есть `member`, и оно отсекается ниже вместе с `<ds.Row>`.
      if (isLayoutModule && s.type !== 'ImportNamespaceSpecifier') fromLayoutModule.add(s.local.name);
    }
  }

  const localUses = new Map();
  let raw = 0;
  const visit = (n, inSvg) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((x) => visit(x, inSvg)); return; }
    let svg = inSvg;
    if (n.type === 'JSXElement') {
      const el = elementName(n);
      if (el.base === 'svg') svg = true;
      const kind = svg ? 'svg' : elementKind(el, imports);
      if (impl) {
        // Внутренности ДС в знаменатель не идут - но сырые теги там СЧИТАЮТСЯ
        // отдельно, иначе «свалить разметку экрана в design/» поднимает долю молча.
        if (kind === 'host') dsShare.implHost += 1;
      } else {
        dsShare[kind] += 1;
        if (kind === 'host') { raw += 1; bump(byTag, el.base); }
        if (kind === 'ds') bump(byComponent, el.member ? `${el.base}.${el.member}` : el.base);
        if (kind === 'local') bump(localUses, el.base);
        // §1f. Условие `kind === 'ds'` несущее: одноимённый локальный `Row`
        // чужого файла - не примитив системы, и считать его двойным владением
        // значит вписать в долг работу, которой там нет.
        // ⚠️ Граница: `import * as ds` + `<ds.Row>` сюда не попадает (`member`),
        // и в `src` таких обращений к примитивам нет ни одного - но появятся,
        // и это будет ТИХИЙ пропуск, а не ошибка.
        const isLayoutPrimitive =
          fromLayoutModule.has(el.base) || layoutPrimitiveNames?.has(importedAs.get(el.base) ?? el.base);
        if (kind === 'ds' && !el.member && isLayoutPrimitive) {
          const v = classNameValueOf(n);
          if (v) {
            const cs = new Set();
            classStringsInto(v, (s) => { for (const t of s.split(/\s+/)) if (t) cs.add(t); });
            if (cs.size) layoutPrimitiveUses.push({ file: f, classes: [...cs] });
          }
        }
      }
    }
    for (const k of Object.keys(n)) if (k !== 'type') visit(n[k], svg);
  };
  visit(ast.body, false);

  // Избыточно по построению - в ветке `impl` выше не трогаются ни `raw`, ни
  // `localUses`, - и оставлено намеренно, а не по недосмотру: оба списка ниже про
  // ЭКРАНЫ, и дописанный когда-нибудь счётчик в ту ветку не должен начать молча
  // наполнять их разметкой самой ДС.
  if (impl) continue;
  if (raw) dsShare.byFile.push([f, raw]);
  for (const [name, uses] of localUses) {
    if (dsExports.has(name)) dsShare.shims.push({ name, file: f, uses });
  }
}
dsShare.byFile.sort((a, b) => b[1] - a[1]);
dsShare.shims.sort((a, b) => b.uses - a.uses);
dsShare.byTag = top(byTag, 15);
dsShare.byComponent = top(byComponent, 15);
dsShare.denominator = dsShare.ds + dsShare.ui + dsShare.host;

/** Сотые доли процента, а не проценты: при знаменателе 3492 один элемент - это
 *  2.9 bp, и в целых процентах правка на три десятка элементов невидима.
 *  ПУСТОЕ ДЕРЕВО - `null`, а не 0: «мерить нечего» и «померили, чисто» не
 *  должны печатать один вердикт (то же правило, что у каталога в §1d). */
const dsShareBp = dsShare.denominator
  ? Math.round((10000 * dsShare.ds) / dsShare.denominator)
  : null;

// ── 2. Inline styles ────────────────────────────────────────────────────────
const inlineCount = (f) => readFileSync(f, 'utf8').match(/style=\{\{/g)?.length ?? 0;

const inlineAll = jsxFiles.reduce((n, f) => n + inlineCount(f), 0);
const inlineByFile = jsxFiles
  .filter(inScope)
  .map((f) => [f, inlineCount(f)])
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);
const inlineScoped = inlineByFile.reduce((n, [, c]) => n + c, 0);

// ── 3. Duplicated shapes ────────────────────────────────────────────────────
/** A "shape" is the SET of properties a rule declares. Same set under a
 *  different class prefix = the same object re-declared in a new namespace. */
const shapes = new Map();
for (const f of scopedCss) {
  for (const m of rulesOf(f)) {
    const sel = m[1].trim();
    if (!sel.startsWith('.')) continue;
    const props = [
      ...new Set(
        m[2]
          .split(';')
          .filter((d) => d.includes(':'))
          .map((d) => d.split(':')[0].trim())
          .filter((p) => p && !p.startsWith('--')),
      ),
    ].sort();
    if (props.length < 3) continue; // 1-2 properties is not a shape, it is a tweak
    const fam = sel.match(/^\.([a-zA-Z][a-zA-Z0-9]*)/)?.[1];
    if (!fam) continue;
    const key = props.join('|');
    if (!shapes.has(key)) shapes.set(key, []);
    shapes.get(key).push(fam);
  }
}
const dupShapes = [...shapes]
  .map(([sig, fams]) => ({ sig, rules: fams.length, families: new Set(fams).size }))
  .filter((s) => s.families >= 4)
  .sort((a, b) => b.rules - a.rules);
const dupShapeRules = dupShapes.reduce((n, s) => n + s.rules, 0);

// ── 4. Alias tokens ─────────────────────────────────────────────────────────
/** Collect every custom-property definition with the selector scope it sits in.
 *  A hand-rolled brace walk beats a regex here: definitions live inside @media
 *  and component scopes, and several share a line. */
function definitions(css, file) {
  const out = [];
  const stack = [];
  let buf = '';
  /** The last declaration in a block may have no trailing `;` — real in this
   *  repo: `.pt-itin{--num:38px;--gap:13px}` (PublicTrip.css). Flushing only on
   *  `;` made that definition invisible, and an invisible definition is the one
   *  failure that matters here: it can hide the second, re-pointed definition of
   *  a token and promote a HANDLE into the "safe to collapse" list. */
  const flush = () => {
    const m = buf.match(/(--[a-zA-Z0-9_-]+)\s*:\s*([\s\S]+)/);
    if (m) out.push({ name: m[1], value: m[2].trim(), scope: stack.at(-1) ?? ':root', file });
    buf = '';
  };
  for (const ch of css) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}') {
      flush();
      stack.pop();
    } else if (ch === ';') {
      flush();
    } else {
      buf += ch;
    }
  }
  return out;
}

const defs = [];
for (const f of cssFiles) defs.push(...definitions(stripComments(readFileSync(f, 'utf8')), f));

const byToken = new Map();
for (const d of defs) {
  if (!byToken.has(d.name)) byToken.set(d.name, []);
  byToken.get(d.name).push(d);
}

const PURE_VAR = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/;
const usageCount = (name) => {
  const re = new RegExp(`var\\(\\s*${name}\\s*[,)]`, 'g');
  return files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(re)?.length ?? 0), 0);
};

/** `:root`, `:root[data-theme=dark]`, `html` … all match the same element, so a
 *  token and its target resolve together there. Anything else is a descendant
 *  scope and can split them. */
const isRootScope = (sel) => /^(:root|html|body)\b/.test(sel.trim());

// ── 4a. The token vocabulary (TRIP-337 §2 · the number guard 2o ratchets) ───
/** A TOKEN IS A NAME VISIBLE FROM EVERYWHERE, AND THE CARRIER OF THAT
 *  VISIBILITY IS `:root`. That is the whole predicate, and every other spelling
 *  of it is wrong in a way that costs something:
 *
 *   • "every `--x:` in src/" (169 today) counts `--num` / `--gap` on
 *     `.pt-itin` and the 40 `--x` on `.btn--primary` / `.tile--xl` /
 *     `.fork-state--err`. Those are set on a container and read by its own
 *     subtree — law 3 of the epic done RIGHT. Worse, collapsing an object into
 *     "base + modifier" is exactly what phases 04–06 produce by the handful, so
 *     that predicate would turn the floor into a brake on the correct move.
 *   • "app.css only" (162) leaves `index.css` — which already has a `:root` —
 *     as a free door, and would leave the third `:root` file of subtask 10 as
 *     another one.
 *
 *  So: root-scoped definitions anywhere under src/. Today 163 = app.css 162 +
 *  `--font-sans` from index.css. The 88 names under `:root[data-theme=dark]`
 *  add NOTHING: they are re-pointings of names the light `:root` already has,
 *  and the set is keyed by NAME.
 *
 *  ★ 163 IS REACHABLE TWO WAYS, AND ONE OF THEM IS BROKEN. A naive count over
 *  app.css alone WITHOUT stripping comments also prints 163: `--sp-9` lives
 *  only in a comment (app.css:141, deleted in Ф13) and contributes exactly the
 *  one unit that `--font-sans` contributes here. A correct implementation and a
 *  broken one print the same number, so "it matches the epic" proves nothing —
 *  the two behaviours are pinned separately, on fixtures, in
 *  check-design-floor.test.mjs. Comments are already gone by this point:
 *  `defs` is built from `stripComments(...)` above. */
const rootTokenNames = new Set();
const scopedDefs = [];
for (const d of defs) {
  if (isRootScope(d.scope)) rootTokenNames.add(d.name);
  else scopedDefs.push(d);
}

/** Names that exist ONLY outside `:root`. REPORTED, NEVER RATCHETED — and
 *  reported BY FILE, because the 20 of them are two different things and a
 *  single number says the wrong one:
 *
 *   • app.css (14) — `--bd`/`--fg` on the `.btn--*` variants, `--tile*` on
 *     `.tile--*`, `--st-accent*` on `.fork-state*`, `--spin*`, `--tmk`, `--ac`.
 *     A variable set on a container and read by its own subtree: law 3 done
 *     RIGHT. Phases 04–06 produce these by the handful — collapsing an object
 *     into "base + modifier" IS this move. Counting them as vocabulary growth
 *     would make the floor a brake on the correct direction.
 *   • everything else (6) — a private dictionary inside a token island:
 *     login.css `.auth` 4 (`--font-body` is a private twin of `--font-sans`,
 *     both TRIP-165) and PublicTrip.css `.pt-itin` 2 (`--num`, `--gap`).
 *     THIS is the hole. It is not this subtask's: login.css is outside the
 *     perimeter until subtask 10, and when it comes in these either collapse
 *     or move into `:root` and fall under the floor by themselves. Printing
 *     them is what stops the hole from being silent.
 *
 *  ⚠ `--gap` is therefore ALREADY TAKEN as a local name on `.pt-itin`. */
const privateFiles = new Map(); // name → the files that declare it outside `:root`
for (const d of scopedDefs) {
  if (rootTokenNames.has(d.name)) continue;
  if (!privateFiles.has(d.name)) privateFiles.set(d.name, new Set());
  privateFiles.get(d.name).add(d.file);
}
const privateTokens = [...privateFiles.keys()]
  .sort()
  .map((name) => ({ name, files: [...privateFiles.get(name)].sort() }));

const synonyms = []; // safe to collapse
const checkTargets = []; // a synonym, but the TARGET is re-pointed on a descendant
const handles = []; // pure var() somewhere, but re-pointed → a parameter
for (const [name, list] of byToken) {
  const targets = list.map((d) => d.value.match(PURE_VAR)?.[1] ?? null);
  if (!targets.some(Boolean)) continue; // never an alias anywhere
  const distinct = new Set(targets);
  const entry = { name, defs: list, uses: usageCount(name) };
  if (!(distinct.size === 1 && targets[0])) {
    handles.push({ ...entry, targets });
    continue;
  }
  const target = targets[0];
  const splitScopes = (byToken.get(target) ?? []).filter((d) => !isRootScope(d.scope)).map((d) => d.scope);
  if (splitScopes.length) checkTargets.push({ ...entry, target, splitScopes: [...new Set(splitScopes)] });
  else synonyms.push({ ...entry, target });
}
const byUses = (a, b) => b.uses - a.uses;
synonyms.sort(byUses);
checkTargets.sort(byUses);
handles.sort(byUses);

// ── 5. Объекты: предикат раньше числа (TRIP-341 PR 0 · закон 8) ─────────────
/** ★ ПОЧЕМУ ЭТА СЕКЦИЯ ВООБЩЕ ЕСТЬ. «Ряд 250 правил в 113 семействах»,
 *  «поверхность 97/91», «плитка 78/55» - числа, по которым предлагалось резать
 *  подзадачи 05 и 06, и ни одно не воспроизводилось: контрольный прогон дал
 *  348/108 · 242/97 · 141/79. Расхождение до пяти раз выглядит как небрежность,
 *  но при разборе обе стороны воспроизвелись ТОЧНО - они не спорили, а считали
 *  разное. Нефиксированных осей оказалось ТРИ, а в §12 В названа одна:
 *
 *    ПРЕДИКАТ  ряд = `flex` / `flex|inline-flex` / без `column` → 288 · 346 · 250
 *    ЕДИНИЦА   селектор или блок объявлений                     → дубли 949 · 294
 *    ПЕРИМЕТР  скоуп аудита или весь src                        → ряд 250 · 291
 *
 *  Строка «ряд 250 / 113» смешивает оси ВНУТРИ СЕБЯ: 250 правил посчитаны в
 *  периметре, 113 семейств - по всему `src` (в периметре их 102). Поэтому
 *  фиксируются все три, а не только предикат.
 *
 *  ★★ ЕДИНИЦА = БЛОК ОБЪЯВЛЕНИЙ, И НАИВНАЯ АЛЬТЕРНАТИВА ЦЕЛИТСЯ В СОБСТВЕННЫЙ
 *  КАНОН. При счёте по СЕЛЕКТОРУ топ «дублей» такой:
 *      199×  font-family:var(--font-mono); font-size:var(--fs-micro); …
 *       82×  font-family:var(--font-ui);   font-size:var(--fs-meta);  …
 *       64×  background:var(--surface); border:1px solid var(--line)
 *  Это не дубли. Это пять правил канона типографики (`app.css:895-977`) - один
 *  блок с перечислением через запятую, ровно та форма, к которой TRIP-165/183
 *  сводили текст и которую сторожит `check:design`. Список из 199 селекторов И
 *  ЕСТЬ схлопнутое состояние. PR, порезанный по этому числу, пошёл бы разбирать
 *  дизайн-систему - то есть метрика назначила бы работой свой собственный ответ.
 *
 *  ПЕРИМЕТР - тот же `scopedCss`, что у секций выше: одна линейка с полом 2o и
 *  каталогом, а лендинг и экран входа всё равно нельзя трогать до подзадачи 10.
 *
 *  ★★★ РАЗБОР ЗДЕСЬ postcss, А ВЫШЕ РЕГУЛЯРКА - НАМЕРЕННО, НЕ НЕДОСМОТР.
 *  Секции 1/3/4 читают CSS своим `rulesOf`, и четыре из пяти чисел, которые они
 *  печатают, стоят под храповиком 2o. Перевести их на postcss В ЭТОМ ЖЕ PR -
 *  значит сдвинуть потолок теми же руками, которыми вводится измерение: ровно
 *  та ошибка, против которой написан §12. Новая секция берёт postcss (уже
 *  прямая зависимость, тот же парсер, что у гарда 2p, рунг 5 лестницы);
 *  перевод остального - отдельная задача, и она обязана предъявить дельту
 *  каждого из пяти чисел пола ОТДЕЛЬНО от любой другой работы. */

/** Правило внутри `@media` - ОТДЕЛЬНОЕ объявление объекта, и это осознанно:
 *  мобильный ряд придётся переселять так же, как десктопный, значит он должен
 *  быть виден в счёте работы. Но у ДУБЛЕЙ media - часть ключа, иначе мобильное
 *  и десктопное значение одного класса схлопнутся в «дубль», которым они не
 *  являются (та же дыра, что ловили мутацией на гарде 2p). */
const mediaOf = (node) => {
  const out = [];
  for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule') out.push(`@${p.name} ${p.params}`);
  return out.reverse().join(' ');
};

const cssParseFailures = [];
/** Один элемент = один блок объявлений (правило). `sels` хранится списком:
 *  единица счёта - блок, но КЛАССЫ и СЕМЕЙСТВА собираются со всех селекторов
 *  блока, потому что переселять придётся каждый из них. */
const blocks = [];
for (const path of scopedCss) {
  let root;
  try {
    root = postcss.parse(readFileSync(path, 'utf8'), { from: path });
  } catch (e) {
    // Молча пропустить нельзя: неразобранный файл выглядит как файл без
    // объектов, то есть занижает объём работ - то же правило, что у 1c.
    cssParseFailures.push(`${path}: ${e.message}`);
    continue;
  }
  root.walkRules((rule) => {
    const decls = new Map();
    rule.walkDecls((d) => decls.set(d.prop, d.value.replace(/\s+/g, ' ').trim()));
    if (!decls.size) return;
    blocks.push({ media: mediaOf(rule), sels: rule.selectors ?? [], decls });
  });
}

/** ★ СЕМЕЙСТВО БЕРЁТСЯ ОТ СТИЛИЗУЕМОГО КЛАССА - ПОСЛЕДНЕГО В СЕЛЕКТОРЕ, не от
 *  ведущего. В `.tl3-card .tile { … }` объявления достаются `.tile`, и переселять
 *  надо его; `tl3` тут не владелец объекта, а тот, кто до него дотянулся (и он
 *  же попадёт в счётчик потомковых правил ниже - то есть учтён, но как другой
 *  дефект). Альтернатива «по ведущему» даёт у ряда 93 семейства вместо 102 и
 *  приписывает объект тому, кто его не объявлял. */
const classesIn = (sel) => [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1]);
const styledClass = (sel) => classesIn(sel).at(-1) ?? null;

const has = (b, p) => b.decls.has(p);
const val = (b, p) => b.decls.get(p) ?? '';
const isFlex = (b) => /^(inline-)?flex$/.test(val(b, 'display'));
const isColumn = (b) => /^column\b/.test(val(b, 'flex-direction'));
const hasBg = (b) => has(b, 'background') || has(b, 'background-color');
const BORDER = /^border(-(top|right|bottom|left))?(-(color|width|style))?$/;
const hasBorder = (b) => [...b.decls.keys()].some((p) => BORDER.test(p));
const centred = (b) => has(b, 'place-items') || (has(b, 'align-items') && has(b, 'justify-content'));
const COLOR_PROP = /^(color|background|background-color|fill|stroke|opacity|border(-(top|right|bottom|left))?-color)$/;
const SPACE_PROP = /^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block))?(-(start|end))?$/;

// ── 3a. Классы, ОБЪЯВЛЯЮЩИЕ раскладку (TRIP-388 · десятое число пола 2o) ────
/** ★ ЗАЧЕМ. Пересадка экрана на примитив имеет объявленную дверь - проброс
 *  `className`. Она нужна (крючок экрана обязан доехать), но через неё же можно
 *  «пересадить» экран, оставив приватный класс живым: элемент получит `.row` И
 *  `.bgt-head`, доля `dsshare` вырастет, а второй источник раскладки останется
 *  под новым именем. `dsshare` этого не видит по построению, 2p тоже (CSS не
 *  менялся). Видит ровно это число: PR пересадки обязан уронить его на те
 *  классы, которые тронул. Не упало - работа замаскирована пробросом.
 *
 *  ПРЕДИКАТ: класс - ПОДЛЕЖАЩЕЕ правила, объявления которого трогают хоть одно
 *  из ПЯТИ свойств, которыми владеет примитив (`display`, `gap`, `align-items`,
 *  `justify-content`, `flex-direction`); разбор форм записи и границы - у
 *  `LAYOUT_PROP` ниже. Подлежащее, а не все классы
 *  селектора: в `.te-x .row {display:flex}` раскладку объявляет `.row`, и
 *  приписывать её `.te-x` значило бы двигать число у нетронутого класса (та же
 *  логика, что у семейства объекта строкой выше).
 *
 *  ★★★ ПОДЛЕЖАЩЕЕ НЕ ЗАВИСИТ ОТ ПОРЯДКА КЛАССОВ В СЕЛЕКТОРЕ. Это не удобство, а
 *  условие того, что число вообще что-то измеряет: `.row.bgt-head` и
 *  `.bgt-head.row` - ОДНО И ТО ЖЕ правило в CSS, и предикат, дающий им разные
 *  ответы, снимается переписыванием места, а не работой. Первая редакция брала
 *  ПЕРВЫЙ класс ступени (`classesIn(tail)[0]`), поэтому `.row.bgt-head` отдавала
 *  канон `row`, приватный `bgt-head` пропадал из наблюдения, и удержанное
 *  объявление раскладки проезжало гейт. Дыра лежала ровно на пути пересадки:
 *  правило экрана, приколотое к примитиву, естественно пишется примитивом
 *  вперёд («когда этот ряд - шапка бюджета, сделать X»).
 *
 *  ПОЭТОМУ: из ступени берутся ВСЕ классы, из них выбрасываются канон-примитивы
 *  и состояния (`is-*`), и объявление записывается на ВСЕ оставшиеся; не
 *  осталось ни одного - на первый. Множественная запись здесь несущая, а не
 *  щедрость: она и делает ответ независимым от порядка (множество классов
 *  ступени порядка не имеет), и ОНА ЖЕ структурно закрывает дефект, ради
 *  которого стоял `[0]`, - объект теперь записывается ВСЕГДА, рядом с любым
 *  состоянием, поэтому «две разные плашки схлопнулись в одну запись на
 *  `is-split`» невозможно по построению, а не по удаче порядка.
 *
 *  ⚠️ ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: состоянием считается только префикс `is-`.
 *  Бесприставочные (`on`, `active`) остаются в наблюдении как объекты. Замер
 *  сегодня: правил раскладки с составной ступенью в периметре РОВНО ОДНО
 *  (`.ncal-wdc-cbar.is-split`), бесприставочных среди них ноль, - то есть цена
 *  границы сейчас нулевая. И если такое правило появится, лишнее имя число
 *  ПОДНИМЕТ, а пол храповит его ВНИЗ: ошибка уедет в красноту, которую автор
 *  увидит, а не в тихое занижение, которое выглядит прогрессом.
 *
 *  ⚠️ ТРЕТЬЯ ГРАНИЦА (нашёл прогон `code-simplifier`, живых случаев ноль): класс
 *  вычитывается РЕГУЛЯРКОЙ по тексту ступени, поэтому функциональная скобка и
 *  строка в атрибуте читаются наивно - `.card:not(.a-x)` запишет ИСКЛЮЧЁННЫЙ
 *  `a-x`, `a[href$=".pdf"]` заведёт класс `pdf`, а `.a-x:is(.b-x,.c-x)` наоборот
 *  ПОТЕРЯЕТ `a-x`. Замер по периметру: селекторов раскладки 439, из них с `:not(`
 *  0, с `:is(`/`:where(` 0, с точкой внутри атрибута 0. Разбирать нечего, и
 *  чинить это до первого случая значит везти в предикат необкатанный код. Первые
 *  два промаха дают ЛИШНЕЕ имя, то есть красноту; `:is(` имя ТЕРЯЕТ - вот его и
 *  закрывать первым, если появится.
 *
 *  ⚠️ ВТОРАЯ ГРАНИЦА: если у последней ступени класса НЕТ (`.checkbox input`,
 *  `.seg button`, `.app-header [data-mobile-toggle]` - 9 живых правил в
 *  периметре), раскладку объявляет голый тег, и запись идёт на БЛИЖАЙШУЮ
 *  ступень, у которой класс есть: снять её всё равно можно только правкой его
 *  набора правил. Альтернатива «не считать вовсе» уносит из наблюдения живые
 *  объявления раскладки и опускает число БЕЗ работы - то есть в ту самую
 *  сторону, куда его храповит пол. Селектор, где класса нет нигде (`div > *`,
 *  `:root`, шаг кейфрейма), не считается никуда. К найденной ступени
 *  применяется ТО ЖЕ правило - иначе порядок классов решал бы ответ этажом
 *  выше (`.row.bgt-head input` против `.bgt-head.row input`), а это та же дыра,
 *  просто в предке. Поэтому `styledClass` (последний класс ВСЕГО селектора)
 *  здесь не зовётся: на нём стоят числа §3/§4, и править его той же рукой,
 *  которой вводится измерение, - ровно ошибка §12.
 *
 *  ★★ КАНОН ЗДЕСЬ - ФИКСИРОВАННЫЙ СПИСОК ПЯТИ СЕМЕЙ, А НЕ КАТАЛОГ. Это
 *  сознательный отказ от `catalog.json`: у `primitiveReach` зависимость от
 *  каталога означает, что переклейка `triage → canon` двигает число БЕЗ строки
 *  CSS, и храповить его нельзя. Здесь список зашит, поэтому число двигают
 *  только правки CSS: схлопнул приватный класс - упало, завёл новый с
 *  раскладкой - выросло, добавил примитив - не шелохнулось. */
const LAYOUT_CANON = /^(row|col|grid|grow|trunc)(--|$)/;
/** ⚠️ ПЯТЬ СВОЙСТВ, А НЕ ОДНО. Примитив владеет `display`, `gap`, `align-items`,
 *  `justify-content`, `flex-direction` - правило объявлено в шапке
 *  `src/design/Layout.jsx`. Первая редакция предиката смотрела ТОЛЬКО `display`,
 *  то есть проверяла пятую часть правила: класс, приехавший через `className` к
 *  `.row` и продолжающий объявлять зазор и выравнивание, получал `display` от
 *  примитива и в число НЕ ПОПАДАЛ. Гейт «число упало» зеленел на работе, которая
 *  не сделана, - причём именно на том ходе, ради которого он и заведён.
 *
 *  ★ СОКРАЩЁННЫЕ ФОРМЫ ЗДЕСЬ НЕ ПЕДАНТИЗМ, А ЗАКРЫТИЕ ДЫРЫ ПО ПОСТРОЕНИЮ.
 *  Проверочный вопрос к любому числу: можно ли, ничего не меняя ПО СУЩЕСТВУ,
 *  переписать место так, чтобы число стало другим? У набора из пяти длинных имён
 *  ответ «да» четырьмя способами - `row-gap`/`column-gap` вместо `gap`,
 *  `place-items` вместо `align-items`, `place-content` вместо `justify-content`,
 *  `flex-flow` вместо `flex-direction`. Это тот же визуальный результат другим
 *  написанием, то есть предикат, чувствительный к форме записи. Форма не
 *  гипотетическая: `place-items` в этом репозитории ЖИВОЙ - он стоит в §3 среди
 *  форм, объявленных заново в девяти семействах.
 *
 *  ⚠️ `display` СЧИТАЕТСЯ ТОЛЬКО FLEX/GRID, а не любым значением: `display:none`
 *  и `display:block` - это видимость и поток, а не раскладка. Считать их значило
 *  бы набить захраповленное число классами, которых ни один PR пересадки не
 *  тронет, и сделать его подвижным от посторонней правки. Остальные четыре
 *  свойства считаются САМИ ПО СЕБЕ, без оглядки на `display`, - в этом вся суть:
 *  у такого класса `display` как раз и приезжает от примитива.
 *
 *  ⚠️ ЕЩЁ ОДНА ФОРМА, НЕ ЗАКРЫТАЯ НАМЕРЕННО: имя свойства читается как есть, а в
 *  CSS оно регистро-независимо (`GAP:` - легально). Замер по периметру через
 *  `postcss`: свойств с не-строчным написанием НОЛЬ, и та же чувствительность
 *  уже есть у соседних предикатов (`val(b,'display')`). Чинить до первого случая
 *  значит везти сюда необкатанный код ради формы, которой никто не пишет. */
const LAYOUT_PROP =
  /^(gap|row-gap|column-gap|align-items|place-items|justify-content|place-content|flex-direction|flex-flow)$/;
const declaresLayout = (b) =>
  /^(inline-)?(flex|grid)$/.test(val(b, 'display')) || [...b.decls.keys()].some((p) => LAYOUT_PROP.test(p));
const IS_STATE = /^is-/;
/** Объекты, которым принадлежит объявление раскладки. См. ★★★ и ⚠️ выше.
 *  Возвращает СПИСОК: у ступени из двух объектов их два, и порядок записи в
 *  селекторе на ответ не влияет. */
const layoutSubjects = (sel) => {
  const steps = sel.trim().split(/[\s>+~]+/);
  for (let i = steps.length - 1; i >= 0; i--) {
    const all = classesIn(steps[i]);
    if (!all.length) continue; // голый тег - спрашиваем ступень выше
    // ⚠️ ОТСЕИВАЮТСЯ ТОЛЬКО СОСТОЯНИЯ, КАНОН - НЕТ. Канон снимается ПОЗЖЕ, при
    // сборке приватного списка, и это не перестановка строк: у первой редакции
    // канон стоял ЗДЕСЬ, и `.row.is-open` (оба класса отброшены → фолбэк на
    // первый) давало канон `row` и 0 приватных, а `.is-open.row` - состояние
    // `is-open` и 1 приватный. Порядок продолжал решать, а в ЗАХРАПОВЛЕННОЕ
    // число попадало имя СОСТОЯНИЯ - тот самый дефект, против которого написан
    // предикат, просто уехавший в фолбэк. Заслонить объект канон не может по
    // построению: записываются ВСЕ оставшиеся, а не один.
    const kept = all.filter((c) => !IS_STATE.test(c));
    return kept.length ? kept : [all[0]];
  }
  return [];
};
const layoutAll = new Set();
for (const b of blocks) {
  if (!declaresLayout(b)) continue;
  for (const sel of b.sels) {
    for (const c of layoutSubjects(sel)) layoutAll.add(c);
  }
}
const layoutPrivateNames = [...layoutAll].filter((c) => !LAYOUT_CANON.test(c)).sort();
const layoutClasses = { total: layoutAll.size, names: layoutPrivateNames };
const layoutPrivateClasses = layoutPrivateNames.length;

/** ── §1f · ДВОЙНОЕ ВЛАДЕНИЕ РАСКЛАДКОЙ (TRIP-388) ──────────────────────────
 *  Узел, который несёт примитив раскладки И приватный класс, ВСЁ ЕЩЁ
 *  объявляющий раскладку. Дословно то, что запрещает апрув Pavel п.3: «класс,
 *  прошедший через `className` и всё ещё объявляющий хоть одно из них — это не
 *  пересадка, а второй источник раскладки под новым именем».
 *
 *  ★ ЗАЧЕМ ЧИСЛО ВООБЩЕ ЗАВЕДЕНО. Пересадка четырёх экранов (152 узла) сдвинула
 *  РОВНО ОДНО из десяти чисел пола - долю из ДС, +440 bp, - а классы,
 *  пространства имён, инлайны и приватные классы раскладки остались как были.
 *  Примитив встал ПОВЕРХ класса, который продолжает владеть раскладкой; довести
 *  это до конца всех экранов значит получить долю у цели при нетронутом зоопарке.
 *  Ни один гард такого не видит: у 2o все числа «только вниз», а PR, который
 *  только ДОБАВЛЯЕТ, ни одного из них не двигает - и пол честно печатает
 *  «держится».
 *
 *  ★★ РЕПОРТ, А НЕ ХРАПОВИК, И ЭТО НЕ МЯГКОСТЬ. Число РАСТЁТ на каждом честном
 *  PR пересадки нового экрана (узлы появляются раньше, чем схлопывается CSS), а
 *  падает на разгребании долга. Храповик «только вниз» блокировал бы ровно то
 *  движение, ради которого заведён, - тот же дефект, что и предикат «все `--x:`»
 *  на токенах. Ратчет уже стоит СОСЕДНИМ числом: приватные классы раскладки
 *  (десятая строка пола) - именно они обязаны падать.
 *
 *  ⚠️ ЭТО НИЖНЯЯ ОЦЕНКА, и граница названа: класс, приезжающий в примитив
 *  ПРОПОМ (`<Row className={props.cls}>`), из литералов не виден. Читать как
 *  «не меньше», а не как «ровно столько».
 *
 *  ⚠️⚠️ ЧИСЛО РАНЬШЕ ПРЕДИКАТА - ЗАКОН ЭПИКА, И ОН УЖЕ НАРУШЕН ИМЕННО ЗДЕСЬ.
 *  Один и тот же долг был назван 38 и 56 в двух прогонах, третий (мой) дал 55.
 *  Никто не ошибался: 38 считало столкновение по ТОМУ ЖЕ свойству, 56/55 - любую
 *  раскладку, и предиката не было ни у одного. Здесь он ЗАФИКСИРОВАН кодом, и
 *  выбран второй: апрув говорит «хоть одно из них», а не «то же самое». */
const dualLayout = { measured: layoutPrimitiveNames !== null, nodes: 0, byFile: [], classes: [] };
if (dualLayout.measured) {
  const priv = new Set(layoutPrivateNames);
  const perFile = new Map();
  const hit = new Set();
  for (const u of layoutPrimitiveUses) {
    const bad = u.classes.filter((c) => priv.has(c));
    if (!bad.length) continue;
    dualLayout.nodes += 1;
    perFile.set(u.file, (perFile.get(u.file) ?? 0) + 1);
    for (const c of bad) hit.add(c);
  }
  dualLayout.byFile = [...perFile].sort((a, b) => b[1] - a[1]);
  dualLayout.classes = [...hit].sort();
}

/** ТАБЛИЦА, А НЕ ДЕСЯТЬ БЛОКОВ КОДА: добавить объект = добавить строку, и его
 *  определение читается рядом с его именем. `why` - не украшение: без него
 *  следующий заход «уточнит» предикат и число снова перестанет быть сравнимым
 *  с самим собой. */
const OBJECTS = [
  {
    key: 'row', label: 'ряд',
    pred: (b) => isFlex(b) && !isColumn(b),
    why: 'flex|inline-flex без column. НЕ «любой flex»: колонка - отдельный объект с отдельным именем .col, и общий счёт считал бы её дважды. НЕ «+ gap обязателен»: ряд без gap остаётся рядом (.row даёт gap по умолчанию), а требование выкинуло бы 45 правил, которые как раз и надо переселить.',
  },
  {
    key: 'col', label: 'колонка',
    pred: (b) => isFlex(b) && isColumn(b),
    why: 'то же + column. column-reverse считается колонкой: направление - модификатор, а не второй объект.',
  },
  {
    key: 'grid', label: 'сетка',
    pred: (b) => /^(inline-)?grid$/.test(val(b, 'display')) && has(b, 'grid-template-columns'),
    why: 'grid + grid-template-columns. НЕ «любой display:grid»: из 127 таких правил 87 - это place-items:center на квадрате, то есть ПЛИТКА. Без этого условия два объекта считали бы друг друга.',
  },
  {
    key: 'trunc', label: 'обрезка',
    pred: (b) => val(b, 'text-overflow') === 'ellipsis' || has(b, '-webkit-line-clamp'),
    why: 'ellipsis или line-clamp. Многострочная обрезка - тот же объект с модификатором «сколько строк», а не второй.',
  },
  {
    key: 'surface', label: 'поверхность',
    pred: (b) => has(b, 'border-radius') && hasBg(b) && (hasBorder(b) || has(b, 'box-shadow')),
    why: 'радиус + фон + (рамка или тень). НЕ «радиус+фон»: одних их 176, и туда попадает каждое цветное ПЯТНО - плитка, бейдж, точка. Поверхность от пятна отличает контур.',
  },
  {
    key: 'tile', label: 'плитка',
    pred: (b) => has(b, 'width') && val(b, 'width') === val(b, 'height') && has(b, 'border-radius') && centred(b),
    why: 'квадрат + радиус + центрирование. Квадрат = ОДИНАКОВАЯ СТРОКА width и height: var(--tile) равен var(--tile) как текст, а вычислять calc() значило бы завести третий парсер в репозитории.',
  },
  {
    key: 'lift', label: 'подъём при наведении',
    pred: (b) => b.sels.some((s) => /:hover/.test(s)) && /translateY/.test(val(b, 'transform')),
    why: 'hover + translateY. НЕ «hover + тень»: тень на ховере - это ПОДСВЕТКА (ярус тинта), другой объект, и смешение раздуло бы счёт с 24 до 35.',
  },
  {
    key: 'colorOnly', label: '«только цвет»',
    pred: (b) => [...b.decls.keys()].every((p) => COLOR_PROP.test(p)),
    why: 'все объявления блока цветовые. Кандидат на переезд в модификатор тона, а не в отдельный класс.',
  },
  {
    key: 'spaceOnly', label: '«только отступ»',
    pred: (b) => [...b.decls.keys()].every((p) => SPACE_PROP.test(p)),
    why: 'все объявления блока отступные. Закон 1: внешний отступ элементу не принадлежит - это кандидат на gap родителя.',
  },
];

const objects = {};
for (const o of OBJECTS) {
  const hit = blocks.filter(o.pred);
  const cls = new Set();
  const byFamily = {};
  for (const b of hit) {
    for (const s of b.sels) {
      const c = styledClass(s);
      if (!c) continue;
      cls.add(c);
      const fam = familyOf(c);
      byFamily[fam] = (byFamily[fam] ?? 0) + 1;
    }
  }
  objects[o.key] = {
    label: o.label,
    why: o.why,
    rules: hit.length,
    classes: cls.size,
    families: Object.keys(byFamily).length,
    _cls: cls,
    _byFamily: byFamily,
    // Распределение - ЭТО и есть то, по чему режутся 05 и 06 (Р11). Круглое
    // число из головы даёт равные PR, распределение - PR по зонам приложения.
    byFamily: Object.fromEntries(Object.entries(byFamily).sort((a, b) => b[1] - a[1])),
  };
}

// §5 ПАРИТЕТ КО-СЕЛЕКТОРА (TRIP-337 объект 2, дожиг). Скин фон+рамка несёт ОБЩЕЕ
// (много-классовое) правило, радиус — отдельным: предикат «radius+bg+border в
// ОДНОМ блоке» их не видит, и «поверхность» занижалась (та же дыра, что закрыл
// замок 2z check-surface-registry). Догоняем счёт: класс — поверхность, если
// фон+рамку получает из общего (≥2 класса) блока И радиус есть где угодно.
{
  const isTileBlock = (b) => has(b, 'width') && val(b, 'width') === val(b, 'height') && has(b, 'border-radius') && centred(b);
  const hasRadiusCls = new Set();
  const coMemberCls = new Set();
  for (const b of blocks) {
    const parts = b.sels.map(styledClass).filter(Boolean);
    if (has(b, 'border-radius')) for (const c of parts) hasRadiusCls.add(c);
    if (parts.length >= 2 && hasBg(b) && (hasBorder(b) || has(b, 'box-shadow')) && !isTileBlock(b)) {
      for (const c of parts) coMemberCls.add(c);
    }
  }
  const s = objects.surface;
  for (const c of coMemberCls) {
    if (!hasRadiusCls.has(c) || s._cls.has(c)) continue;
    s._cls.add(c);
    const fam = familyOf(c);
    s._byFamily[fam] = (s._byFamily[fam] ?? 0) + 1;
    s.rules += 1;   // недосчитанный носитель = минимум своё radius-правило
  }
  s.classes = s._cls.size;
  s.families = Object.keys(s._byFamily).length;
  s.byFamily = Object.fromEntries(Object.entries(s._byFamily).sort((a, b) => b[1] - a[1]));
}

/** Наборы-дубли: блоки с ПОБАЙТОВО совпадающим набором `свойство:значение`.
 *  Порог ≥2 свойств - одно свойство это не объект, а твик (тот же порог, что у
 *  секции 3, где он 3, но там ключ - только имена свойств без значений).
 *  Отдельно отмечается, лежит ли набор в 2+ семействах: набор, размноженный
 *  внутри ОДНОГО семейства, - его внутреннее дело и не про унификацию. */
const dupIndex = new Map();
for (const b of blocks) {
  if (b.decls.size < 2) continue;
  const c = styledClass(b.sels[0] ?? '');
  if (!c) continue;
  const sig = [...b.decls].map(([p, v]) => `${p}:${v}`).sort().join('; ');
  const key = `${b.media}||${sig}`;
  if (!dupIndex.has(key)) dupIndex.set(key, { sig, media: b.media, members: [] });
  dupIndex.get(key).members.push(c);
}
const dupSets = [...dupIndex.values()]
  .filter((d) => d.members.length >= 2)
  .map((d) => ({ ...d, families: [...new Set(d.members.map(familyOf))] }))
  .sort((a, b) => b.members.length - a.members.length);
const dupCross = dupSets.filter((d) => d.families.length >= 2);
const rulesIn = (sets) => sets.reduce((n, d) => n + d.members.length, 0);
const dupSetRules = rulesIn(dupSets);
const dupSetRulesCrossFamily = rulesIn(dupCross);

/** ★ §12 Б · потомковые правила на примитивах. 47 / 57 / 275 не воспроизводятся
 *  ни при одном определении, и главное - три числа мерили РАЗНОЕ. Осмысленный
 *  вопрос ровно один, и его задаёт закон 3: «потомковый селектор на примитиве
 *  может только переопределить переменную, которую примитив читает». Значит
 *  предикат нарушения - НЕ «кто-то дотянулся», а «дотянулся И ОБЪЯВИЛ НАСТОЯЩЕЕ
 *  СВОЙСТВО».
 *
 *  Живой образец обоих исходов в одном правиле - `app.css:3840`:
 *      .tl3-card .tile { --tile:44px; --tile-ic:20px; --tile-r:…;   ← законно
 *                        background: var(--evs,…); color: var(--evi,…) }  ← нет
 *  Три переопределения ручек - это ровно то, что закон 3 разрешает; два
 *  объявления рядом - то, ради чего пишется подзадача 06.
 *
 *  ★ ДВЕ ЛОВУШКИ, ОБЕ ЗАВЫШАЮТ ЧИСЛО И ОБЕ БЫЛИ В ПЕРВОЙ РЕДАКЦИИ ЭТОГО СЧЁТЧИКА:
 *   1. `.btn.is-on` - это ДВА класса, но ОДИН элемент: составной селектор,
 *      модификатор или состояние, и никакого «дотянулся внутрь» там нет.
 *      Потомство определяется КОМБИНАТОРОМ (пробел, `>`, `+`, `~`), а не тем,
 *      что классов в строке больше одного. Без этого в нарушения попадал каждый
 *      `.btn--primary:hover` и число раздувалось со 105 до 153.
 *   2. `.card .badge` - канон внутри канона: это КОМПОЗИЦИЯ дизайн-системы,
 *      её собственное устройство. Считать её долгом экранов - записать в работу
 *      06 то, что 06 не трогает. Поэтому владелец и цель сравниваются, и
 *      канон→канон печатается ОТДЕЛЬНОЙ строкой, а не молча приплюсовывается.
 *
 *  Разбиение на составные части грубее спеки (`:not(.a .b)` не разворачивается),
 *  но одинаково для всех строк - тот же компромисс, что у `specificity()` в 2p.
 *
 *  ⚠ ЭТО ЧИСЛО ЗАВИСИТ ОТ КАТАЛОГА ПО ПОСТРОЕНИЮ, и знать это надо ДО того, как
 *  его во что-нибудь вставят. Нарушение определено как «дотянулись до КАНОН-
 *  семейства», поэтому переклейка `triage → canon` - легальная, бесплатная и
 *  никогда не блокируемая (см. шапку каталога) - молча ПОДНИМАЕТ его, а
 *  `canon → triage` молча опускает. Замерено прямо в этом PR: возврат семейства
 *  `is` в разбор дал 61 → 58 при нуле тронутых строк CSS.
 *  Для ОТЧЁТА это правильно: вопрос «кто дотягивается внутрь языка системы»
 *  обязан переезжать вместе с границей языка. Но храповить это число нельзя, и
 *  размер подзадачи 06 нельзя фиксировать им как константой - та же переклейка,
 *  которая не стоит ни строки кода, сдвинет объявленный объём работ. Ровно тот
 *  класс ловушки, о котором вся эта секция: метрика, отвечающая собственным
 *  определением. Поэтому 06 берёт отсюда СПИСОК (`byFamily`, `samples`), а не
 *  число, и пересчитывает его на своей базе. */
/** ★★ ГРАНИЦА ЯЗЫКА, ПО КОТОРОЙ СЧИТАЕТСЯ ДОСЯГАЕМОСТЬ, УМЕЕТ ЗАДАВАТЬСЯ ИЗВНЕ
 *  (TRIP-364, `AUDIT_CANON_FAMILIES`). Это НЕ настройка на вкус, а лечение
 *  противоречия, названного абзацем выше: число зависит от каталога по
 *  построению, поэтому переклейка `triage → canon` - легальный, бесплатный и
 *  никогда не блокируемый ход - его ПОДНИМАЕТ. Захрапови сырое число, и гард
 *  станет красным на правильном ходе, а такой гард выключают.
 *
 *  Лечение доктринальное: не ослабить проверку и не заставлять писать
 *  `floor-exempt` на поощряемое движение, а МЕРИТЬ ОБЕ СТОРОНЫ ОДНОЙ МЕРКОЙ.
 *  Пол 2o передаёт сюда канон-набор БАЗЫ, когда меряет HEAD, — тогда число
 *  двигают только правки CSS, а переклейка не двигает вовсе. Отчёт (без env)
 *  по-прежнему считает по своему каталогу: вопрос «кто дотягивается внутрь
 *  языка» обязан переезжать вместе с границей языка. */
const canonOverride = process.env.AUDIT_CANON_FAMILIES;
const canonFamilies = new Set(
  canonOverride !== undefined
    ? canonOverride.split(',').filter(Boolean)
    : catalogStatuses
      ? Object.entries(catalogStatuses).filter(([, s]) => s === 'canon').map(([f]) => f)
      : [],
);
/** Составные части селектора: `.a > .b .c` → ['.a', '.b', '.c']. Каждая часть -
 *  ОДИН элемент; классов внутри неё может быть сколько угодно. */
const compoundsOf = (sel) => sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
const isRealProp = (p) => !p.startsWith('--');

/** ★★ ВЫЧЕТ СОБСТВЕННОГО КАНОНА ТИПОГРАФИКИ (TRIP-364), без которого число нельзя
 *  храповить. Единый источник текст-стилей объявлен СО-СЕЛЕКТОРНЫМ списком
 *  (`app.css:578` и соседние): рядом с `.t-subheading` перечислены `.wdg-h h4`,
 *  `.bell-dd__head .t-ui`, `.tl3-card .body b` - элементы, которым канон
 *  ПЕРЕНАЗНАЧАЕТ текст-стиль. Предикат `reach` читает такую строку как «экран
 *  дотянулся до примитива `.t` и объявил font-family», хотя это механизм самой
 *  ДС (TRIP-175/183), а не долг экрана. Захрапови мы сырое число - считали бы
 *  долгом собственный канон; в этом эпике наивный предикат целился в свой канон
 *  уже дважды (199 «дублей» и «canon = одиночки»).
 *
 *  Предикат ВЫБРАН ЗАМЕРОМ, а не на глаз, и два кандидата различаются ровно
 *  живым дефектом: «правило объявляет ТОЛЬКО типографические свойства» даёт 14,
 *  «правило ЕСТЬ канон - среди его селекторов есть голый `.t-*`» даёт 13, и
 *  разница - `.ncal-ev .t { font-size }` в CalendarLens.css, то есть экран,
 *  ужимающий кегль примитива. Это НАСТОЯЩЕЕ нарушение, и первый предикат его
 *  прощал. Берём второй.
 *
 *  Вычтенное печатается ОТДЕЛЬНОЙ строкой, а не исчезает: вычет, которого не
 *  видно, - это тот же бланкетный escape, только внутри метрики.
 *
 *  ★★ ВТОРОЕ УСЛОВИЕ - НЕ УКРАШЕНИЕ, А ЗАКРЫТИЕ КАНАЛА ОБХОДА (нашёл
 *  `code-simplifier` прогоном). Проверяй мы только «есть голый `.t-*` среди
 *  селекторов» - допиши такой со-селектор к своему правилу, и ЛЮБОЕ нарушение
 *  закона 3 исчезнет из ЗАХРАПОВЛЕННОГО числа: `.t-sub, .scr-a .card { padding:
 *  99px }` давало 0. Поэтому вычитается правило, которое И стоит в канон-списке,
 *  И объявляет ТОЛЬКО типографику. На живом коде оба условия дают одни и те же
 *  13 правил (пересечение замерено), то есть закрытие канала не стоит ни одного
 *  числа - но снимает дверь, которой у храповика быть не должно. */
const TYPO_PROPS = new Set([
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'font-style', 'font-variant-numeric',
]);
const isTypographyCanon = (b) =>
  b.sels.some((s) => /^\.t-[a-z]+$/.test(s.trim())) &&
  [...b.decls.keys()].filter(isRealProp).every((p) => TYPO_PROPS.has(p));

const reach = {
  violations: 0,
  varOnly: 0,
  canonIntoCanon: 0,
  canonTypography: 0,
  canonTypographyWouldViolate: 0,
  byFamily: {},
  samples: [],
};
for (const b of blocks) {
  const typographyCanon = isTypographyCanon(b);
  const declaresReal = [...b.decls.keys()].some(isRealProp);
  let violation = false;
  let legal = false;
  let inner = false;
  for (const s of b.sels) {
    const parts = compoundsOf(s);
    if (parts.length < 2) continue; // составной селектор - не потомство
    const styled = styledClass(parts.at(-1));
    const owner = classesIn(parts[0])[0];
    if (!styled || !owner) continue;
    const styledFam = familyOf(styled);
    const ownerFam = familyOf(owner);
    if (!canonFamilies.has(styledFam) || ownerFam === styledFam) continue;
    if (canonFamilies.has(ownerFam)) { inner = true; continue; }
    if (declaresReal) {
      violation = true;
      // Вычтенное правило не попадает НИ В ОДИН счётчик долга, включая
      // разбивку по семьям и примеры: иначе 06 пошла бы чинить канон.
      if (typographyCanon) continue;
      reach.byFamily[ownerFam] = (reach.byFamily[ownerFam] ?? 0) + 1;
      if (reach.samples.length < 12) reach.samples.push(`${s} { ${[...b.decls.keys()].filter(isRealProp).join('; ')} }`);
    } else {
      legal = true;
    }
  }
  if (typographyCanon) {
    // Печатается и то, СКОЛЬКО из вычтенного было бы долгом: строка «вычтено 13»
    // рядом со «53» читается как «на самом деле 66», а это неправда - долгом из
    // них были бы единицы. Число в ревью никто не перепроверяет.
    reach.canonTypography += 1;
    if (violation) reach.canonTypographyWouldViolate += 1;
    continue;
  }
  if (violation) reach.violations += 1;
  else if (legal) reach.varOnly += 1;
  if (inner) reach.canonIntoCanon += 1;
}
reach.byFamily = Object.fromEntries(Object.entries(reach.byFamily).sort((a, b) => b[1] - a[1]));

// ── Report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

/** ★ ОДНОГО `writeSync` НЕДОСТАТОЧНО: НА ТРУБЕ ОН ПИШЕТ ЧАСТЬ И ВОЗВРАЩАЕТ,
 *  СКОЛЬКО ЗАПИСАЛ. Прежняя редакция вылечила асинхронность `console.log` и
 *  уцелела только потому, что payload помещался в буфер трубы целиком; секция
 *  объектов его превысила, и остаток молча пропал, а `process.exit(0)` ниже
 *  добил. Симптом тот же самый, что чинили в прошлый раз (`jq` падает
 *  «Unfinished JSON term at EOF»), причина другая - поэтому лечение в цикле.
 *
 *  Поймал это НЕ ревьюер и не глаз, а собственный тест гарда «--json переживает
 *  ТРУБУ, а не только перенаправление в файл»: он покраснел ровно на 8192-м
 *  байте. Ради этого класса ошибок он и написан - в файл на POSIX всё пишется
 *  разом, и через `> файл` баг невидим.
 *
 *  EAGAIN тоже обрабатывается: stdout, привязанный к трубе, Node может держать
 *  неблокирующим, и тогда переполненная труба отвечает ошибкой, а не нулём. */
const writeAll = (fd, text) => {
  const buf = Buffer.from(text, 'utf8');
  // EAGAIN значит «труба полна, читатель не успевает». Повторять СРАЗУ - это
  // busy-wait на 100% CPU против медленного читателя, поэтому между попытками
  // спим миллисекунду. `Atomics.wait` - единственный СИНХРОННЫЙ сон в stdlib
  // (рунг 3 лестницы), а синхронный он обязан быть: асинхронный сон здесь
  // вернул бы управление в цикл событий, и `process.exit(0)` ниже оборвал бы
  // запись - то есть ровно тот баг, ради которого вся эта функция и написана.
  const idle = new Int32Array(new SharedArrayBuffer(4));
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      if (e.code !== 'EAGAIN') throw e;
      Atomics.wait(idle, 0, 0, 1);
    }
  }
};

/** `--catalog-draft` prints a WHOLE catalog file the way the predicate would
 *  fill it in. It is a proposal for a human to read and edit, which is why it
 *  goes to stdout instead of overwriting `catalog.json`: a generator that
 *  rewrites the file it is checked against turns the catalog into 2l's editable
 *  baseline, and the whole point of committing it is that a status change is a
 *  reviewable line rather than a re-run. */
if (process.argv.includes('--catalog-draft')) {
  const draft = Object.fromEntries(
    [...families.keys()].sort().map((f) => [f, designFamilies.has(f) ? 'canon' : 'triage']),
  );
  // Тоже через writeAll: черновик каталога - это 282 семейства, он уже сейчас
  // около границы буфера трубы, и `--catalog-draft | jq` обязан быть целым.
  writeAll(1, JSON.stringify({ families: draft }, null, 2) + '\n');
  process.exit(0);
}

if (process.argv.includes('--json')) {
  /** `writeSync`, НЕ `console.log`. В ТРУБУ (`… --json | jq`) stdout у Node
   *  асинхронный, и стоящий ниже `process.exit(0)` рвал вывод на полуслове: в
   *  ФАЙЛ уезжали все 569 строк, в трубу - 344. То есть машинный интерфейс
   *  молча отдавал битый JSON, `jq` падал «Unfinished JSON term at EOF», а в
   *  CI-скрипте это читалось бы как «аудит упал», хотя аудит отработал.
   *  Прожило незамеченным потому, что запись в файл на POSIX синхронная - при
   *  проверке через `> файл` всё было цело, и баг видно только через трубу. */
  writeAll(
    1,
    JSON.stringify(
      {
        families: families.size,
        classes: classes.size,
        heavyFamilies: heavy.length,
        tailFamilies: tail.length,
        namespaces,
        namespacesInReach,
        singletons,
        singletonsStandalone,
        singletonsAttached,
        familyKinds,
        perimeterFamilies,
        parseFailures,
        // The catalog (TRIP-340). `triageClasses` is the fifth number guard 2o
        // ratchets; `catalogStatuses` is what lets it name the promotions.
        triageClasses,
        // The seventh (TRIP-364 PR-I): entries in `apart`. The catalog's own
        // header promises this list "must empty out" — until now nothing held
        // it to that, and apart was the one place an appearance could be filed
        // with a reason while every number stayed green.
        apartEntries,
        // Восьмое (TRIP-364 PR-I): только ВВЕРХ, см. объявление выше.
        axesFamilies,
        catalogStatuses,
        catalogMissing,
        catalogStale,
        catalogInvalid,
        catalogError,
        designFamilies: [...designFamilies].sort(),
        familiesInReach,
        inlineScoped,
        inlineAll,
        rootTokens: rootTokenNames.size,
        // The NAMES, not just how many. Guard 2o needs both sides' sets to spot
        // a DEMOTION: a name that leaves `:root` for a class scope makes the
        // count go DOWN while the vocabulary is unchanged — the name merely hid.
        rootTokenNames: [...rootTokenNames].sort(),
        privateTokens,
        // ГЛАВНОЕ ЧИСЛО ЭПИКА (TRIP-337 §1): доля элементов интерфейса, взятых
        // из ДС. Плоское `dsShareBp` храповит 2o (в сотых долях процента и
        // ТОЛЬКО ВВЕРХ), `dsShare` держит обе кучи и обе названные границы.
        dsShareBp,
        dsShare: { ...dsShare, byFile: dsShare.byFile.slice(0, 15) },
        // TRIP-388: классы, ОБЪЯВЛЯЮЩИЕ раскладку. Плоское число - десятая
        // строка пола 2o (вниз), СПИСОК ИМЁН - то, из чего 2o печатает, какие
        // именно классы ушли и пришли: «упало на столько же» и «упало на тех
        // классах, которые PR тронул» - разные факты, и одним счётом второй не
        // проверяется (тот же довод, что у `rootTokenNames` строкой выше).
        layoutClasses,
        layoutPrivateClasses,
        dualLayout,
        // Объекты (TRIP-341 PR 0). `byFamily` - то, по чему режутся 05 и 06.
        objects,
        cssParseFailures,
        dupSets: dupSets.length,
        dupSetRules,
        dupSetsCrossFamily: dupCross.length,
        dupSetRulesCrossFamily,
        dupTop: dupCross.slice(0, 25).map((d) => ({ sig: d.sig, media: d.media, count: d.members.length, members: d.members })),
        primitiveReach: reach,
        // Плоское число для храповика 2o (метрики читаются как `json[field]`), и
        // канон-набор, которым оно посчитано, — им пол меряет HEAD той же меркой.
        reachViolations: reach.violations,
        canonFamiliesUsed: [...canonFamilies].sort(),
        dupShapes: dupShapes.length,
        dupShapeRules,
        synonyms: synonyms.map((s) => ({ name: s.name, target: s.target, uses: s.uses })),
        checkTargets: checkTargets.map((s) => ({
          name: s.name,
          target: s.target,
          uses: s.uses,
          splitScopes: s.splitScopes,
        })),
        handles: handles.map((h) => ({ name: h.name, uses: h.uses, scopes: h.defs.map((d) => d.scope) })),
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(0);
}

console.log('\n═══ TRIP-321 · дизайн-слой ═══');
console.log(`  скоуп: ${ROOT}/**  без ${OUT_OF_SCOPE.source}\n`);

console.log('1. СЕМЕЙСТВА И КЛАССЫ');
console.log(`   семейств (всего):    ${num(families.size, 5)}`);
console.log(`   классов:             ${num(classes.size, 5)}`);
console.log(`   тяжёлых (10+ кл.):   ${num(heavy.length, 5)}  ← держат ${heavy.reduce((n, [, c]) => n + c, 0)} классов, это работа`);
console.log(`   хвост (<10 кл.):     ${num(tail.length, 5)}  ← держат ${tail.reduce((n, [, c]) => n + c, 0)} классов, это шум`);
console.log(`   топ: ${sorted.slice(0, 12).map(([f, n]) => `${f}(${n})`).join(' · ')}\n`);

console.log('1b. ИЗ ЧЕГО СОСТОИТ ЭТО ЧИСЛО (три разные работы, не одна)');
console.log(`   ПРОСТРАНСТВА ИМЁН:   ${num(namespaces, 5)}  ← префикс владеет потомками. ЭТО унификация, цель ~30`);
console.log(`     из них в работе:   ${num(namespacesInReach, 5)}  ← ★ ЕДИНСТВЕННОЕ число, к которому цель «→30» приложима`);
console.log(`   приклеенные:         ${num(singletonsAttached, 5)}  ← имя без префикса: .statbar .k, .blk.locked`);
console.log('                                 переименование в .statbar__k, ноль визуального риска,');
console.log('                                 ноль эффекта на дизайн. Цель 0, но это ГИГИЕНА, не унификация.');
console.log(`   словарь ДС:          ${num(singletonsStandalone, 5)}  ← input · select · checkbox · panel…`);
console.log('                                 к нулю НЕ сводится и не должен: это имена самой системы.');
if (perimeterFamilies.length) {
  console.log(`\n   исключённый периметр:${num(perimeterFamilies.length, 5)}  ← правила лендинга/авторизации живут в app.css,`);
  console.log('                                 но разметка их вне скоупа → тронуть нельзя, а в цель они попали:');
  console.log(`                                 ${perimeterFamilies.join(' · ')}`);
  console.log(`   СЕМЕЙСТВ В РАБОТЕ:   ${num(familiesInReach, 5)}  ← вот по чему честно мерить прогресс`);
  if (parseFailures.length) {
    console.log(`\n   ⚠ НЕ РАЗОБРАНО ФАЙЛОВ: ${parseFailures.length} - их классы НЕ учтены, число выше занижено:`);
    for (const p of parseFailures) console.log(`     ${p}`);
  }
}
console.log();

console.log('1d. КАТАЛОГ: КАНОН И РАЗБОР (гард 2o храповит «на разборе»)');
if (catalogError) {
  console.log(`   ⚠ КАТАЛОГ НЕ ПРОЧИТАН: ${catalogError}`);
  console.log('     Это НЕ «каталога нет»: сломанный файл не должен выключать пятое число.');
} else if (!catalogStatuses) {
  console.log(`   каталога нет (${CATALOG_PATH}) - пятое число не измеряется`);
} else {
  // Both lines read the STATUS; neither is `total - canon`. The subtraction is
  // the tempting spelling, and it files unmarked and mistyped families under
  // "under review" — while `triageClasses` does not count their classes. Two
  // lines of one block would then disagree by exactly the families the ⚠ below
  // is about: the same "the number counted something else" trap 2o reds on.
  const fams = (status) => [...families.keys()].filter((f) => catalogStatuses[f] === status).length;
  console.log(`   канон:               ${num(fams('canon'), 5)} семейств`);
  console.log(`   на разборе:          ${num(fams('triage'), 5)} семейств`);
  console.log(`   КЛАССОВ НА РАЗБОРЕ:  ${num(triageClasses, 5)}  ← это число храповит 2o`);
  if (catalogMissing.length) console.log(`   ⚠ НЕ РАЗМЕЧЕНЫ (${catalogMissing.length}): ${catalogMissing.join(' · ')}`);
  if (catalogStale.length) console.log(`   ⚠ УСТАРЕЛИ, семейства уже нет (${catalogStale.length}): ${catalogStale.join(' · ')}`);
  if (catalogInvalid.length) console.log(`   ⚠ НЕВЕРНЫЙ СТАТУС (${catalogInvalid.length}): ${catalogInvalid.join(' · ')}`);
  const drift = [...designFamilies].filter((f) => catalogStatuses[f] !== 'canon').sort();
  if (drift.length) {
    console.log(`   ─ предикат зовёт каноном, а в каталоге разбор (${drift.length}): ${drift.join(' · ')}`);
    console.log('     Это не ошибка: машина не видит экранных имён, зашитых ВНУТРЬ компонента ДС.');
  }
}
console.log();

console.log('1e. ПРИЛОЖЕНИЕ СОБРАНО ИЗ СИСТЕМЫ (главное число эпика, храповит 2o ВВЕРХ)');
if (dsShareBp === null) {
  console.log('   элементов интерфейса ноль - мерить нечего (это НЕ 0%)');
} else {
  console.log(`   ДОЛЯ ИЗ ДС:          ${(dsShareBp / 100).toFixed(2)}%  ← ${dsShare.ds} из ${dsShare.denominator} листьев разметки`);
  console.log(`   сырых тегов:         ${num(dsShare.host, 5)}  ← это и есть «экран рисует сам»`);
  console.log(`   легаси components/ui:${num(dsShare.ui, 5)}  ← в знаменателе: переезд в design/ обязан поднимать долю`);
  console.log(`   не в счёте:          композиция ${dsShare.app} · локальные ${dsShare.local} · вендор ${dsShare.vendor} · svg ${dsShare.svg} · нерендерящие ${dsShare.nonRendering}`);
  console.log(`   сырые теги ВНУТРИ ДС:${num(dsShare.implHost, 5)}  ← репорт: свалить разметку экрана в design/ подняло бы долю`);
  console.log(`   топ файлов по сырым тегам: ${dsShare.byFile.slice(0, 8).map(([f, n]) => `${f.replace(/^.*\//, '')}(${n})`).join(' · ')}`);
  console.log(`   взято из ДС: ${dsShare.byComponent.slice(0, 10).map(([c, n]) => `${c}(${n})`).join(' · ')}`);
  // Вклад тега = что будет с долей, когда он станет компонентом ДС: элемент
  // уезжает из знаменателя в числитель, знаменатель тот же. Это и есть довод о
  // порядке фаз - число, а не мнение.
  console.log('   ─ сырые теги и вклад каждого в долю, если он станет компонентом ДС:');
  for (const [tag, n] of dsShare.byTag.slice(0, 8)) {
    console.log(`      <${tag}>`.padEnd(15) + `${String(n).padStart(5)}   +${((100 * n) / dsShare.denominator).toFixed(1)} п.п.`);
  }
  if (dsShare.shims.length) {
    console.log(`   ─ локальный компонент повторяет имя из ДС (${dsShare.shims.length}) - цена границы «своя композиция не считается»:`);
    for (const s of dsShare.shims) console.log(`      ${s.name} ×${s.uses} в ${s.file}`);
  }
}
// Печатается ВНЕ ветки доли: у десятого числа свой предикат (CSS, а не разметка),
// и пустое дерево разметки - не повод не печатать замер по CSS. Сама пара стоит
// рядом намеренно: у PR пересадки одно число идёт вверх, другое вниз.
console.log(`   классов с РАСКЛАДКОЙ: ${layoutClasses.total}, из них ПРИВАТНЫХ ${layoutPrivateClasses}  ← десятая строка пола 2o (только вниз)`);
console.log(`      первые 10 по алфавиту: ${layoutPrivateNames.slice(0, 10).join(' · ')}  (весь список - в --json; что именно ушло, печатает 2o)`);
// §1f. Печатается СРАЗУ ПОД приватными классами: это две половины одного
// вопроса - сколько имён ещё владеет раскладкой и сколько узлов держат ДВУХ
// владельцев сразу. Репорт, не гейт (разбор - в шапке `dualLayout`).
if (!dualLayout.measured) {
  console.log('   двойное владение раскладкой: НЕ ИЗМЕРЕНО - нет src/design/Layout.jsx  ← это не ноль');
} else {
  console.log(`   ДВОЙНОЕ ВЛАДЕНИЕ раскладкой: ${dualLayout.nodes} узлов · ${dualLayout.classes.length} классов  ← примитив ДС + приватный класс, всё ещё объявляющий раскладку`);
  if (dualLayout.nodes) {
    console.log(`      по экранам: ${dualLayout.byFile.slice(0, 8).map(([f, n]) => `${f.replace(/^.*\//, '')}(${n})`).join(' · ')}`);
    console.log(`      классы: ${dualLayout.classes.slice(0, 10).join(' · ')}${dualLayout.classes.length > 10 ? ' …' : ''}  (весь список - в --json)`);
    console.log('      ⚠ нижняя оценка: класс, приезжающий в примитив ПРОПОМ, из литералов не виден');
  }
}
console.log();

console.log('2. ИНЛАЙНОВЫЕ СТИЛИ');
console.log(`   в скоупе:            ${num(inlineScoped, 5)}`);
console.log(`   весь src:            ${num(inlineAll, 5)}`);
console.log(`   топ: ${inlineByFile.slice(0, 6).map(([f, n]) => `${f.split('/').pop()}(${n})`).join(' · ')}\n`);

console.log('3. ФОРМЫ, ОБЪЯВЛЕННЫЕ ЗАНОВО (один объект под разными именами)');
console.log(`   форм в 4+ семействах:${num(dupShapes.length, 5)}`);
console.log(`   правил под ними:     ${num(dupShapeRules, 5)}`);
for (const s of dupShapes.slice(0, 6)) {
  console.log(`     ${num(s.rules, 3)} правил / ${num(s.families, 2)} семейств :: ${s.sig.slice(0, 70)}`);
}
console.log();


console.log('4. ТОКЕНЫ');
console.log(`   в :root (гард 2o храповит это число): ${rootTokenNames.size}`);
if (privateTokens.length) {
  console.log(`   объявлены ТОЛЬКО вне :root (под пол НЕ попадают, репорт без блокировки): ${privateTokens.length}`);
  const byFile = new Map();
  for (const t of privateTokens) {
    for (const f of t.files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(t.name);
    }
  }
  for (const [f, names] of [...byFile].sort()) {
    const note = /app\.css$/.test(f)
      ? 'переменная на варианте, читается своим же поддеревом - закон 3, так и надо'
      : 'приватный словарь в островке токенов - дыра, закрывается в подзадаче 10';
    console.log(`     ${f} (${names.length}) - ${note}`);
    console.log(`       ${[...new Set(names)].sort().join(' · ')}`);
  }
}
console.log();

console.log('4b. ТОКЕНЫ-АЛИАСЫ');
console.log(`   СИНОНИМЫ (все определения → одна цель, цель не расщеплена; схлопываются): ${synonyms.length}`);
for (const s of synonyms) console.log(`     ${pad(s.name, 18)} → ${pad(s.target, 18)} ${num(s.uses, 4)} исп.`);
console.log(`\n   СИНОНИМЫ С РАСЩЕПЛЁННОЙ ЦЕЛЬЮ (сверить места использования глазами): ${checkTargets.length}`);
for (const s of checkTargets) {
  console.log(`     ${pad(s.name, 18)} → ${pad(s.target, 18)} ${num(s.uses, 4)} исп.`);
  console.log(`         цель переопределена в: ${s.splitScopes.slice(0, 4).join(' · ')}`);
}
console.log(`\n   РУЧКИ (сам токен переопределяется; НЕ ТРОГАТЬ): ${handles.length}`);
for (const h of handles) {
  const scopes = [...new Set(h.defs.map((d) => `${d.scope.slice(0, 34)} = ${d.value.slice(0, 26)}`))];
  console.log(`     ${pad(h.name, 18)} ${num(h.uses, 4)} исп.`);
  for (const s of scopes) console.log(`         ${s}`);
}
console.log();

console.log('5. ОБЪЕКТЫ (TRIP-341 · единица = БЛОК объявлений, периметр = скоуп выше)');
if (cssParseFailures.length) {
  console.log(`   ⚠ НЕ РАЗОБРАНО CSS-ФАЙЛОВ: ${cssParseFailures.length} - их объекты НЕ учтены, числа ниже занижены:`);
  for (const p of cssParseFailures) console.log(`     ${p}`);
}
console.log(`   блоков объявлений в периметре: ${blocks.length}`);
for (const o of OBJECTS) {
  const r = objects[o.key];
  console.log(`   ${pad(r.label, 22)} ${num(r.rules, 4)} правил · ${num(r.classes, 4)} классов · ${num(r.families, 3)} семейств`);
  const top = Object.entries(r.byFamily).slice(0, 8);
  if (top.length) console.log(`     ${top.map(([f, n]) => `${f}(${n})`).join(' · ')}`);
}
console.log('\n   НАБОРЫ-ДУБЛИ (побайтово тот же набор свойство:значение, ≥2 свойств)');
console.log(`     всего:            ${num(dupSets.length, 4)} наборов / ${dupSetRules} правил`);
console.log(`     в 2+ семействах:  ${num(dupCross.length, 4)} наборов / ${dupSetRulesCrossFamily} правил  ← это работа`);
for (const d of dupCross.slice(0, 10)) {
  console.log(`       ${num(d.members.length, 3)}× ${d.sig.slice(0, 86)}`);
  console.log(`            ${d.members.slice(0, 8).map((c) => `.${c}`).join(' ')}${d.members.length > 8 ? ' …' : ''}`);
}
console.log('\n   ПОТОМКОВЫЕ ПРАВИЛА НА ПРИМИТИВАХ (§12 Б · закон 3)');
console.log(`     экран дотянулся и ОБЪЯВИЛ СВОЙСТВО: ${num(reach.violations, 4)}  ← нарушение закона 3, это работа 06`);
console.log(`     дотянулся и переопределил ТОЛЬКО ручку: ${num(reach.varOnly, 4)}  ← закон 3 это РАЗРЕШАЕТ`);
console.log(`     канон внутри канона:                ${num(reach.canonIntoCanon, 4)}  ← композиция ДС, не долг экранов`);
console.log(`     вычтен канон типографики:           ${num(reach.canonTypography, 4)}  ← со-селекторный список .t-*, механизм самой ДС`);
console.log(`       из них были бы долгом:            ${num(reach.canonTypographyWouldViolate, 4)}  ← остальные не нарушали и без вычета`);
if (Object.keys(reach.byFamily).length) {
  console.log(`     кто дотягивается: ${Object.entries(reach.byFamily).slice(0, 10).map(([f, n]) => `${f}(${n})`).join(' · ')}`);
  for (const s of reach.samples.slice(0, 5)) console.log(`       ${s.slice(0, 96)}`);
}
console.log();
