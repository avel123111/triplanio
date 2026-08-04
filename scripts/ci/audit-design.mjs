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
 * Four sections:
 *   1. FAMILIES  — a class-name prefix is a namespace. 37 heavy families hold
 *      the real work, ~280 tiny ones are one-off noise.
 *   2. INLINE    — `style={{…}}` occurrences (the ratchet itself is guard 2l).
 *   3. SHAPES    — rules grouped by their SET of properties. A shape declared
 *      in 4+ different families is the same object re-invented under a new
 *      name; this is the number the whole unification is aimed at.
 *   4. ALIASES   — tokens whose value is nothing but `var(--other)`.
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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

function classesOf(fileList) {
  const set = new Set();
  for (const f of fileList) {
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
      set.add(m[1]);
    }
  }
  return set;
}

const classes = classesOf(cssFiles.filter(inScope));
const families = new Map();
for (const c of classes) {
  const f = familyOf(c);
  families.set(f, (families.get(f) ?? 0) + 1);
}
const sorted = [...families].sort((a, b) => b[1] - a[1]);
const heavy = sorted.filter(([, n]) => n >= 10);
const tail = sorted.filter(([, n]) => n < 10);

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
for (const f of cssFiles.filter(inScope)) {
  const css = stripComments(readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
  console.log(
    JSON.stringify(
      {
        families: families.size,
        classes: classes.size,
        heavyFamilies: heavy.length,
        tailFamilies: tail.length,
        inlineScoped,
        inlineAll,
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
    ),
  );
  process.exit(0);
}

console.log('\n═══ TRIP-321 · дизайн-слой ═══');
console.log(`  скоуп: ${ROOT}/**  без ${OUT_OF_SCOPE.source}\n`);

console.log('1. СЕМЕЙСТВА И КЛАССЫ');
console.log(`   семейств:            ${num(families.size, 5)}`);
console.log(`   классов:             ${num(classes.size, 5)}`);
console.log(`   тяжёлых (10+ кл.):   ${num(heavy.length, 5)}  ← держат ${heavy.reduce((n, [, c]) => n + c, 0)} классов, это работа`);
console.log(`   хвост (<10 кл.):     ${num(tail.length, 5)}  ← держат ${tail.reduce((n, [, c]) => n + c, 0)} классов, это шум`);
console.log(`   топ: ${sorted.slice(0, 12).map(([f, n]) => `${f}(${n})`).join(' · ')}\n`);

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

console.log('4. ТОКЕНЫ-АЛИАСЫ');
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
