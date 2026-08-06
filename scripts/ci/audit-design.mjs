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
import { join } from 'node:path';
import { Parser as AcornParser } from 'acorn';
import acornJsx from 'acorn-jsx';

const ROOT = process.env.AUDIT_ROOT || 'src';

/** Files the TRIP-321 unification does not touch (landing / auth / public perimeter).
 *  They are still SCANNED for alias definitions — a token island there is exactly
 *  what makes a global rename unsafe — but excluded from the family/class counts. */
const OUT_OF_SCOPE = /(^|\/)(login\.css|PublicTrip|JoinTrip|SiteChrome|Landing|Privacy|Terms)/;

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
const inScope = (f) => !OUT_OF_SCOPE.test(f);

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

const classNameTokens = (f) => {
  const out = new Set();
  const add = (s) => { for (const tok of s.split(/\s+/)) if (tok) out.add(tok); };
  let ast;
  try {
    ast = JsxParser.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    // Молча пропустить нельзя: непрочитанный файл выглядит как файл без классов,
    // а это ровно «нечего проверять» и «проверено, чисто» с одинаковым вердиктом.
    parseFailures.push(`${f}: ${e.message}`);
    return out;
  }
  const strings = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(strings); return; }
    if (n.type === 'Literal' && typeof n.value === 'string') add(n.value);
    if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => add(q.value.cooked ?? q.value.raw));
    for (const k of Object.keys(n)) if (k !== 'type') strings(n[k]);
  };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'JSXAttribute' && n.name?.name === 'className') { strings(n.value); return; }
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

// ── Report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

if (process.argv.includes('--json')) {
  /** `writeSync`, НЕ `console.log`. В ТРУБУ (`… --json | jq`) stdout у Node
   *  асинхронный, и стоящий ниже `process.exit(0)` рвал вывод на полуслове: в
   *  ФАЙЛ уезжали все 569 строк, в трубу - 344. То есть машинный интерфейс
   *  молча отдавал битый JSON, `jq` падал «Unfinished JSON term at EOF», а в
   *  CI-скрипте это читалось бы как «аудит упал», хотя аудит отработал.
   *  Прожило незамеченным потому, что запись в файл на POSIX синхронная - при
   *  проверке через `> файл` всё было цело, и баг видно только через трубу. */
  writeSync(
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
        familiesInReach,
        inlineScoped,
        inlineAll,
        rootTokens: rootTokenNames.size,
        privateTokens,
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
