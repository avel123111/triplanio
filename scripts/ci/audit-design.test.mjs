#!/usr/bin/env node
/**
 * Tests for the design-layer audit (scripts/ci/audit-design.mjs).
 *
 * WHY (TRIP-321). The load-bearing part of this script is the ALIAS
 * CLASSIFIER, and the obvious version of it is wrong in a way that ships a
 * production bug: "the value is a pure var()" marks theme handles, state
 * handles and token-island names as deletable synonyms. Collapsing those
 * repaints the dark header, kills the warm finish marker and changes five
 * colours on the auth screen. Both the original TRIP-321 plan AND the first
 * review of it produced a hand-made "safe to delete" list; both lists were
 * wrong, in different places. So the classifier gets a test before anything is
 * deleted on its say-so.
 *
 * The three trap shapes below are lifted from real declarations in
 * src/design/app.css and src/pages/login.css.
 *
 * Each test writes a throwaway CSS/JSX tree and runs the script as a
 * subprocess with AUDIT_ROOT pointing at it, the way CI runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./audit-design.mjs', import.meta.url));

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-design-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    env: { ...process.env, AUDIT_ROOT: dir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `script failed:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const names = (list) => list.map((x) => x.name);

// ── The alias classifier: the three traps ───────────────────────────────────

test('a token defined once as a pure var() IS a collapsible synonym', (t) => {
  const out = run(fixture(t, { 'a.css': ':root { --surface-2: #eee; --wash: var(--surface-2); }' }));
  assert.deepEqual(names(out.synonyms), ['--wash']);
  assert.equal(out.synonyms[0].target, '--surface-2');
  assert.deepEqual(names(out.handles), []);
});

test('TRAP 1 — a theme handle is NOT a synonym (--header-bg: light vs dark)', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      :root { --header-bg: var(--surface); }
      :root[data-theme="dark"] { --header-bg: var(--bg); }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), [], 'a theme handle must never be offered for deletion');
  assert.deepEqual(names(out.handles), ['--header-bg']);
});

test('TRAP 2 — a component state handle is NOT a synonym (--tmk on .tmk--finish)', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      .tmk { --tmk: var(--brand); }
      .tmk--finish { --tmk: var(--warm); }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), ['--tmk']);
});

test('TRAP 3 — a token island is NOT a synonym (--wash: var() in :root, literal in .auth)', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --wash: var(--surface-2); }',
      'login.css': '.auth { --wash: #F7F8FA; }',
    }),
  );
  assert.deepEqual(
    names(out.synonyms),
    [],
    'login.css is a separate token island — substituting the target repaints the auth screen',
  );
  assert.deepEqual(names(out.handles), ['--wash']);
});

test('the island trap is caught even though login.css is out of SCOPE for the counts', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --brand-600: var(--primary-hover); } .x { color: var(--brand-600); }',
      'login.css': '.auth { --brand-600: #1b58c4; }',
    }),
  );
  // Out-of-scope files are excluded from family/class counts but MUST still be
  // scanned for definitions — that is the whole point of the trap.
  assert.deepEqual(names(out.handles), ['--brand-600']);
  assert.deepEqual(names(out.synonyms), []);
});

test('MIRROR TRAP — a clean alias whose TARGET is re-pointed on a descendant needs eyeballing', (t) => {
  const out = run(
    fixture(t, {
      'app.css': ':root { --r-btn: 12px; --r-control: var(--r-btn); }',
      'login.css': '.auth { --r-btn: 8px; }',
    }),
  );
  assert.deepEqual(names(out.synonyms), [], 'not safe: inside .auth the two names differ');
  assert.deepEqual(names(out.checkTargets), ['--r-control']);
  assert.deepEqual(out.checkTargets[0].splitScopes, ['.auth']);
});

test('a target re-pointed only across THEMES is still safe (same element)', (t) => {
  // :root and :root[data-theme=dark] match the same element, so --x and --y
  // resolve together — this must NOT be demoted, or every token in the file
  // ends up in the manual pile and the tool stops being useful.
  const out = run(
    fixture(t, {
      'app.css': `
      :root { --surface-2: #eee; --secondary: var(--surface-2); }
      :root[data-theme="dark"] { --surface-2: #222; }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), ['--secondary']);
  assert.deepEqual(names(out.checkTargets), []);
});

test('two different targets under the same name is a handle, not a synonym', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.p { --x: var(--a); } .q { --x: var(--b); }' }),
  );
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), ['--x']);
});

test('a definition with no trailing `;` (last in its block) is still seen', (t) => {
  // Real shape from PublicTrip.css: `.pt-itin{--num:38px;--gap:13px}`.
  // A missed definition is the one failure that matters — it can hide the
  // second, re-pointed definition and promote a handle into "safe to collapse".
  const out = run(fixture(t, { 'a.css': ':root{--x:var(--y)}' }));
  assert.deepEqual(names(out.synonyms), ['--x']);
});

test('a handle is still a handle when its second definition has no trailing `;`', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.p{--x:var(--a);} .q{--x:var(--b)}' }),
  );
  assert.deepEqual(names(out.synonyms), [], 'the `;`-less definition must not be invisible');
  assert.deepEqual(names(out.handles), ['--x']);
});

test('a token that is never a pure var() is not reported at all', (t) => {
  const out = run(fixture(t, { 'a.css': ':root { --c: #fff; --d: calc(var(--e) - 4px); }' }));
  assert.deepEqual(names(out.synonyms), []);
  assert.deepEqual(names(out.handles), []);
});

test('definitions are found inside @media and multiple-per-line', (t) => {
  const out = run(
    fixture(t, {
      'a.css': `
      :root { --p: var(--q); --r: var(--s); }
      @media (max-width: 640px) { :root { --p: var(--other); } }`,
    }),
  );
  assert.deepEqual(names(out.synonyms), ['--r'], '--p is re-pointed inside @media → handle');
  assert.deepEqual(names(out.handles), ['--p']);
});

// ── Counts ──────────────────────────────────────────────────────────────────

test('out-of-scope files do not contribute to family/class counts', (t) => {
  const out = run(
    fixture(t, {
      'app.css': '.aa-one { color: red; } .aa-two { color: red; }',
      'login.css': '.zz-only-here { color: red; }',
    }),
  );
  assert.equal(out.families, 1, 'only the `aa` family counts');
  assert.equal(out.classes, 2);
});

// ── The token vocabulary: the number guard 2o ratchets (TRIP-337 §2) ────────
/** ★ WHY EVERY ONE OF THESE IS PINNED SEPARATELY. On the live repo the count is
 *  163 — AND 163 IS REACHABLE TWO WAYS. A naive count over app.css alone that
 *  does NOT strip comments also prints 163: `--sp-9` survives in a comment
 *  (app.css:141) and contributes exactly the one unit that `--font-sans` from
 *  index.css contributes to the correct answer. A right implementation and a
 *  broken one print the same number, so "it matches the epic" proves nothing
 *  and the acceptance criterion has to be these fixtures instead.
 *
 *  The predicate is `:root`, and the two obvious "simplifications" of it — drop
 *  the scope test and count every `--x:` in src/, or keep only app.css — are
 *  each wrong in a way that costs real work. They are pinned as tests so a
 *  future refactor cannot make the number come out right for the wrong reason. */

test('a token that exists ONLY in a comment is not counted (--sp-9, app.css:141)', (t) => {
  const out = run(
    fixture(t, { 'app.css': ':root { --sp-8: 20px; /* --sp-9:24px выпилен - шкала кончается на 8 */ }' }),
  );
  assert.equal(out.rootTokens, 1, 'the comment must not mint a token');
});

test('a token in the :root of a SECOND file is counted (--font-sans, index.css)', (t) => {
  // The "app.css only" spelling would leave index.css — which already has a
  // `:root` — as a free door, and the third `:root` file of subtask 10 as
  // another one. A token is a name visible from everywhere; `:root` carries it.
  const out = run(
    fixture(t, { 'app.css': ':root { --ink: #111; }', 'index.css': ':root { --font-sans: Golos; }' }),
  );
  assert.equal(out.rootTokens, 2);
});

test('a dark-theme re-pointing adds nothing: the set is keyed by NAME', (t) => {
  // 88 names live under :root[data-theme=dark] on the live repo and every one of
  // them is a re-pointing of a name the light :root already has.
  const out = run(
    fixture(t, {
      'app.css': ':root { --ink: #111; --bg: #fff; } :root[data-theme="dark"] { --ink: #eee; --bg: #000; }',
    }),
  );
  assert.equal(out.rootTokens, 2);
});

test('a variable on a component variant is NOT a token (.btn--primary{--fg:…})', (t) => {
  // Law 3 done RIGHT: set on a container, read by its own subtree. Phases 04–06
  // produce these by the handful — collapsing an object into "base + modifier"
  // IS this move — so counting them would make the floor a brake on the correct
  // direction. It is reported without blocking instead.
  const out = run(
    fixture(t, {
      'app.css': ':root { --ink: #111; } .btn { --fg: var(--ink); color: var(--fg); } .btn--primary { --fg: #fff; }',
    }),
  );
  assert.equal(out.rootTokens, 1, 'only --ink is vocabulary');
  assert.deepEqual(names(out.privateTokens), ['--fg']);
  // Reported BY FILE: the live repo's 20 are two different things, and one
  // number says the wrong one (14 in app.css are law 3, 6 elsewhere are a hole).
  assert.deepEqual(out.privateTokens[0].files.map((f) => f.split('/').pop()), ['app.css']);
});

test('a private dictionary in a token island is reported, never counted (.auth)', (t) => {
  // login.css `.auth` holds 4 such names (`--font-body` is a private twin of
  // `--font-sans`, both TRIP-165). That IS the hole — and it is not this
  // subtask's: login.css is outside the perimeter until subtask 10.
  const out = run(
    fixture(t, {
      'app.css': ':root { --font-sans: Golos; }',
      'login.css': '.auth { --font-body: Golos; --line-2: #eee; }',
    }),
  );
  assert.equal(out.rootTokens, 1);
  assert.deepEqual(names(out.privateTokens), ['--font-body', '--line-2']);
});

test('a name defined BOTH in :root and on a class is vocabulary, not private', (t) => {
  const out = run(
    fixture(t, { 'app.css': ':root { --tile: 38px; } .tile--lg { --tile: 46px; }' }),
  );
  assert.equal(out.rootTokens, 1);
  assert.deepEqual(names(out.privateTokens), [], 'a re-pointing of a global name is not a private name');
});

test('a token defined inside @media { :root } is counted', (t) => {
  const out = run(
    fixture(t, { 'app.css': '@media (min-width: 640px) { :root { --ctl-h: 44px; } }' }),
  );
  assert.equal(out.rootTokens, 1);
});

test('inline styles are counted in scope and overall', (t) => {
  const out = run(
    fixture(t, {
      'A.jsx': 'const a = <i style={{width: 1}}/>; const b = <i style={{top: 2}}/>;',
      'Landing/B.jsx': 'const c = <i style={{left: 3}}/>;',
    }),
  );
  assert.equal(out.inlineScoped, 2);
  assert.equal(out.inlineAll, 3);
});

test('a shape repeated across 4+ families is reported, across 3 is not', (t) => {
  const body = 'display: flex; align-items: center; gap: 8px;';
  const three = run(
    fixture(t, { 'a.css': `.aa-x{${body}} .bb-x{${body}} .cc-x{${body}}` }),
  );
  assert.equal(three.dupShapes, 0, '3 families is under the threshold');

  const four = run(
    fixture(t, { 'a.css': `.aa-x{${body}} .bb-x{${body}} .cc-x{${body}} .dd-x{${body}}` }),
  );
  assert.equal(four.dupShapes, 1);
  assert.equal(four.dupShapeRules, 4);
});

test('a rule with fewer than 3 properties is a tweak, not a shape', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.aa-x{display:flex;gap:8px} .bb-x{display:flex;gap:8px} .cc-x{display:flex;gap:8px} .dd-x{display:flex;gap:8px}' }),
  );
  assert.equal(out.dupShapes, 0);
});

test('custom properties do not count as shape properties', (t) => {
  // `--ev-color` style parameters would otherwise inflate every shape signature.
  const out = run(
    fixture(t, { 'a.css': '.aa-x{--p:1;--q:2;display:flex}' }),
  );
  assert.equal(out.dupShapes, 0);
});

test('--json survives a PIPE, not just a redirect to a file', () => {
  // The machine-readable output is the half a CI step would consume, and it was
  // truncated by `process.exit(0)`: on a pipe Node's stdout is async, so exit
  // cut the JSON mid-token. 569 lines reached a FILE, 344 reached a pipe — and
  // a redirect (POSIX file writes are synchronous) showed nothing wrong, which
  // is why it survived. `jq` reported "Unfinished JSON term at EOF", i.e. a
  // healthy audit reads as a crashed one.
  // Piping through `cat` is the whole point: `spawnSync` alone would not
  // reproduce it on the small fixtures the other tests use.
  const r = spawnSync('/bin/sh', ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(SCRIPT)} --json | cat`], {
    env: { ...process.env, AUDIT_ROOT: 'src' },
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotThrow(() => JSON.parse(r.stdout), 'the JSON must be whole after a pipe');
  assert.ok(JSON.parse(r.stdout).families > 0);
});

// ── Phantom families: a dot inside a string is not a class ──────────────────
// TRIP-321 audit: the family count is about to become a ratchet, and it was
// counting two namespaces that do not exist anywhere in the product —
// `@import './design/fonts.css'` minted `css`, and the @font-face
// `url('...woff2')` minted `woff2`. A ratchet that counts phantoms can be
// "improved" by deleting a font, and can never reach its target.

test('a file path in @import does not mint a family', (t) => {
  const out = run(
    fixture(t, { 'a.css': "@import './design/fonts.css';\n.aa-x { color: red; }" }),
  );
  assert.deepEqual([...Object.keys(out.familyKinds)].sort(), ['aa']);
  assert.equal(out.families, 1, '`css` from the import path is not a namespace');
});

test('a font url() does not mint a family', (t) => {
  const out = run(
    fixture(t, {
      'a.css': "@font-face { src: url('/fonts/exo.woff2') format('woff2'); }\n.aa-x { color: red; }",
    }),
  );
  assert.equal(out.families, 1, '`woff2` from the url is not a namespace');
});

test('a dotted value inside a double-quoted string does not mint a family', (t) => {
  const out = run(fixture(t, { 'a.css': '.aa-x { content: ".zz-fake"; }' }));
  assert.equal(out.families, 1);
});

// ── The split: a prefix that owns nothing is not a namespace ────────────────
// TRIP-321: "295 families" is three different things in one number, and only
// the first of them is the work this task is about. Collapsing `.statbar .k`
// into `.statbar__k` moves 81 "families" without deleting a single duplicated
// shape — so the two must never be reported as one figure.

test('a prefix with descendants is a namespace; a lone name is not', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.aa { color: red; } .aa-x { color: red; } .solo { color: red; }' }),
  );
  assert.equal(out.namespaces, 1, '`aa` owns `aa-x`');
  assert.equal(out.singletons, 1, '`solo` owns nothing');
  assert.equal(out.families, 2, 'the headline number stays the sum, for comparability');
});

test('a BEM modifier makes a prefix a namespace (it owns its own variants)', (t) => {
  const out = run(fixture(t, { 'a.css': '.tile { color: red; } .tile--lg { color: red; }' }));
  assert.equal(out.namespaces, 1);
  assert.equal(out.singletons, 0);
});

test('a lone name that is only ever a DESCENDANT is attached, not standalone', (t) => {
  // `.statbar .k` mints the family `k`. Nobody bought that namespace — it is a
  // private child of `statbar` written without a prefix. It must not be
  // reported next to `input`/`select`, which are real design-system names.
  const out = run(
    fixture(t, {
      'a.css': '.statbar { color: red; } .statbar-row { color: red; } .statbar .k { color: red; } .input { color: red; }',
    }),
  );
  assert.equal(out.familyKinds.k, 'attached', '`k` is a private child of `statbar`');
  assert.equal(out.familyKinds.input, 'standalone', '`input` stands on its own');
  assert.equal(out.familyKinds.statbar, 'namespace');
});

test('a state class glued to another class is attached, not standalone', (t) => {
  const out = run(fixture(t, { 'a.css': '.blk { color: red; } .blk.locked { color: red; }' }));
  assert.equal(out.singletonsAttached, 1, '`locked` never leads a selector');
});

test('a class that leads in ONE place is standalone even if it is a descendant elsewhere', (t) => {
  const out = run(
    fixture(t, { 'a.css': '.panel .chip { color: red; } .chip { color: red; }' }),
  );
  assert.equal(out.familyKinds.chip, 'standalone');
  assert.equal(out.singletonsAttached, 0);
});

test('the leading class is found inside @media too', (t) => {
  const out = run(
    fixture(t, { 'a.css': '@media (max-width: 640px) { .chip { color: red; } }' }),
  );
  assert.equal(out.singletonsStandalone, 1, 'a nested rule must not read as "never leads"');
});

// ── The excluded perimeter leaks into the denominator ───────────────────────
// TRIP-321: the scope drops login.css and PublicTrip.css, but the LANDING's
// rules live in app.css. Those families are counted in the target and can
// never be worked on — the goal is understated by however many there are.

test('a class used only by out-of-scope markup is flagged as excluded perimeter', (t) => {
  const out = run(
    fixture(t, {
      'app.css': '.ccy { color: red; } .aa-x { color: red; }',
      'LandingPage.jsx': 'const a = <i className="ccy"/>;',
      'Trips.jsx': 'const b = <i className="aa-x"/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['ccy']);
  assert.equal(out.familiesInReach, 1, 'only `aa` can actually be worked on');
});

test('a class used by BOTH perimeters is in reach, not excluded', (t) => {
  const out = run(
    fixture(t, {
      'app.css': '.shared { color: red; }',
      'LandingPage.jsx': 'const a = <i className="shared"/>;',
      'Trips.jsx': 'const b = <i className="shared"/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, []);
});

test('a class named in an ordinary string is not "usage" — only className counts', (t) => {
  // The first cut scanned every quoted string and found nothing at all: `nav`,
  // `dur` and `tx` occur as plain quoted words in in-scope files, so every
  // family stayed "in reach" and the section reported a zero it had not earned.
  const out = run(
    fixture(t, {
      'app.css': '.nav { color: red; }',
      'LandingPage.jsx': 'const a = <i className="nav"/>;',
      'Trips.jsx': 'const b = track("nav"); const c = <i className="tr-row"/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['nav'], 'a quoted word is not a class usage');
});

test('an IDENTIFIER inside a className expression is not a class (ревью Codex, PR #659)', (t) => {
  // `className={flag ? "hero" : ""}` was tokenised WHOLESALE, so the variable
  // name `flag` was recorded as markup usage. A `.flag` rule then looked "used",
  // and if that expression sat only in an out-of-scope file the family was filed
  // as excluded perimeter and SUBTRACTED from the goal — the audit understating
  // its own workload, which is the one direction a target must never drift.
  // Only static string/template fragments are markup; everything else is code.
  const out = run(
    fixture(t, {
      'app.css': '.flag { color: red; } .hero { color: red; }',
      'LandingPage.jsx': 'const a = <i className={flag ? "hero" : ""}/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['hero'], '`flag` is a variable, only `hero` is a class');
});

test('a class glued on conditionally inside a template IS markup usage', (t) => {
  // The mirror of the test above: cutting expressions must not throw away the
  // real class names quoted INSIDE them. `` `cbar${on ? ' on' : ''}` `` applies
  // both `cbar` and `on`.
  const out = run(
    fixture(t, {
      'app.css': '.cbar { color: red; } .on { color: red; }',
      'LandingPage.jsx': 'const a = <i className={`cbar${x ? " on" : ""}`}/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['cbar', 'on']);
});

test('a NESTED template inside an interpolation is parsed (ревью Codex, PR #661)', (t) => {
  // `` className={`foo${on ? ` bar` : ''}`} `` - самодельный разбор строк ловил
  // открывающий backtick вложенного шаблона как ЗАКРЫВАЮЩИЙ у внешнего, и класс
  // `bar` проваливался между совпадениями.
  const out = run(
    fixture(t, {
      'app.css': '.foo { color: red; } .bar { color: red; }',
      'LandingPage.jsx': 'const a = <i className={`foo${on ? ` bar` : ""}`}/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['bar', 'foo']);
});

test('a brace inside a STRING does not swallow the rest of the file (ревью Codex, PR #661)', (t) => {
  // `className={value === "{" ? "foo" : ""}` - счётчик скобок считал `{` внутри
  // строки структурной, до нуля не доходил, и в разбор уезжал ВЕСЬ ОСТАТОК
  // ФАЙЛА: любая последующая обычная строка записывалась как класс.
  const out = run(
    fixture(t, {
      'app.css': '.foo { color: red; } .unrelated { color: red; }',
      'LandingPage.jsx': 'const a = <i className={v === "{" ? "foo" : ""}/>;\nconst label = "unrelated";',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['foo'], '`unrelated` - обычная строка, не класс');
});

test('a comment that quotes a class name is not markup usage', (t) => {
  // Тот же класс ошибки с другой стороны: апостроф/кавычка в комментарии не
  // должны ни создавать употребление, ни ломать разбор соседних строк.
  const out = run(
    fixture(t, {
      'app.css': '.hero { color: red; }',
      'LandingPage.jsx': '// Mapbox\'s own note about "hero"\nconst a = <i className="hero"/>;',
      'Trips.jsx': '// the "hero" class is documented here only\nconst b = <i className="tr-row"/>;',
    }),
  );
  assert.deepEqual(out.perimeterFamilies, ['hero'], 'упоминание в комментарии Trips.jsx - не употребление');
});

test('a class with no markup usage at all is NOT called excluded perimeter', (t) => {
  // Silence must not read as "belongs to the landing". A descendant class
  // (`.card > .x`) has no className of its own and would be misfiled wholesale.
  const out = run(fixture(t, { 'app.css': '.orphan { color: red; }' }));
  assert.deepEqual(out.perimeterFamilies, []);
});

// ── 1d. Каталог: канон и разбор (TRIP-340) ──────────────────────────────────
/**
 * ЧТО ИМЕННО ЗДЕСЬ ПИНИТСЯ. Предикат канона был написан в тикете в
 * ПЕРЕВЁРНУТОМ виде («канон = словарь ДС = 82 одиночки»), и это не описка: он
 * читается прямо с отчёта выше и ошибается в ОБЕ стороны сразу. Поэтому
 * фиксируется не «сколько получилось», а обе стороны инверсии - что попадает в
 * канон и что в него НЕ попадает, - плюс три способа каталогу разойтись с
 * деревом, из которых один заставляет число ПАДАТЬ.
 */
function runDraft(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--catalog-draft'], {
    env: { ...process.env, AUDIT_ROOT: dir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `script failed:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const catalog = (families) => JSON.stringify({ families });

test('★ ИНВЕРСИЯ: пространство имён, которое эмитит ДС, - кандидат в канон', (t) => {
  // Ровно тот случай, который формулировка из тикета отправляла в triage:
  // .btn владеет .btn--primary, значит `namespace`, а НЕ `standalone`.
  const d = runDraft(
    fixture(t, {
      'design/app.css': '.btn{color:red} .btn--primary{color:blue}',
      'design/index.jsx': 'const B = <button className="btn btn--primary"/>;',
    }),
  );
  assert.equal(d.families.btn, 'canon');
});

test('★ ИНВЕРСИЯ: одиночка, которую ДС не эмитит, каноном НЕ становится', (t) => {
  // 74 из тех самых 82: экранные остатки (bookrow, wmini, mapfs…). Формулировка
  // из тикета делала каноном именно их - то есть ту самую кучу, ради которой
  // всё и затевалось.
  const d = runDraft(
    fixture(t, {
      'design/app.css': '.bookrow{color:red}',
      'pages/DocsLens.jsx': 'const A = <i className="bookrow"/>;',
    }),
  );
  assert.equal(d.families.bookrow, 'triage');
});

test('components/ui считается источником ДС наравне с design/', (t) => {
  const d = runDraft(
    fixture(t, {
      'design/app.css': '.toast{color:red} .toast__body{color:blue}',
      'components/ui/toast.jsx': 'const T = <i className="toast"/>;',
    }),
  );
  assert.equal(d.families.toast, 'canon');
});

test('нет каталога → triageClasses = null, а не 0 и не «всё разбор»', (t) => {
  // «Нечего проверять» и «проверено, чисто» обязаны различаться: 0 означало бы
  // «разбор закончен», и пятое число молча отчиталось бы победой.
  const out = run(fixture(t, { 'design/app.css': '.a-1{color:red}' }));
  assert.equal(out.triageClasses, null);
  assert.equal(out.catalogStatuses, null);
  assert.deepEqual(out.catalogMissing, []);
});

test('классы считаются только у семейств в статусе triage', (t) => {
  const out = run(
    fixture(t, {
      'design/app.css': '.btn{color:red} .btn--p{color:red} .bgt-row{color:red} .bgt-k{color:red} .bgt-v{color:red}',
      'design/catalog.json': catalog({ btn: 'canon', bgt: 'triage' }),
    }),
  );
  assert.equal(out.triageClasses, 3, 'три .bgt-*, канон .btn в счёт не идёт');
});

test('семейство, которого нет в каталоге, - НЕ «ноль классов», а catalogMissing', (t) => {
  // Молчание тут занижает объём работ: класс не посчитан нигде.
  const out = run(
    fixture(t, {
      'design/app.css': '.btn{color:red} .newfam-x{color:red}',
      'design/catalog.json': catalog({ btn: 'canon' }),
    }),
  );
  assert.deepEqual(out.catalogMissing, ['newfam']);
  assert.equal(out.triageClasses, 0, 'неразмеченное семейство не считается разобранным');
});

test('строка каталога про исчезнувшее семейство - catalogStale', (t) => {
  const out = run(
    fixture(t, {
      'design/app.css': '.btn{color:red}',
      'design/catalog.json': catalog({ btn: 'canon', gone: 'triage' }),
    }),
  );
  assert.deepEqual(out.catalogStale, ['gone']);
});

test('★ опечатка в статусе НЕ читается как triage - и потому роняет число', (t) => {
  // Самая опасная из трёх: «canonn» не равно triage, значит классы семейства
  // выпадают из счёта и метрика ПАДАЕТ - выглядит прогрессом. Пинится и факт
  // обнаружения, и то, что число при этом действительно занижено: гард 2o
  // краснеет именно поэтому, а не «на всякий случай».
  const out = run(
    fixture(t, {
      'design/app.css': '.bgt-a{color:red} .bgt-b{color:red}',
      'design/catalog.json': catalog({ bgt: 'canonn' }),
    }),
  );
  assert.deepEqual(out.catalogInvalid, ['bgt: "canonn"']);
  assert.equal(out.triageClasses, 0, 'именно так число и падает: опечатка вычла семейство из счёта');
});

test('сломанный JSON каталога - это catalogError, а НЕ «каталога нет»', (t) => {
  // Иначе лишняя скобка = способ выключить пятое число.
  const out = run(
    fixture(t, { 'design/app.css': '.a-1{color:red}', 'design/catalog.json': '{ "families": { ' }),
  );
  assert.match(out.catalogError ?? '', /catalog\.json/);
  assert.equal(out.triageClasses, null);
});

test('каталог без объекта families - тоже ошибка, а не пустой каталог', (t) => {
  const out = run(fixture(t, { 'design/app.css': '.a-1{color:red}', 'design/catalog.json': '[]' }));
  assert.match(out.catalogError ?? '', /families/);
});

test('"families": null - ошибка, а не «каталога нет»', (t) => {
  // `typeof null === 'object'`, поэтому эта форма ближе всего к тому, чтобы
  // СЛОМАННЫЙ файл прочитался как ОТСУТСТВУЮЩИЙ - то есть ровно тот способ
  // выключить пятое число, против которого и написана проверка.
  const out = run(
    fixture(t, { 'design/app.css': '.a-1{color:red}', 'design/catalog.json': '{ "families": null }' }),
  );
  assert.match(out.catalogError ?? '', /families/);
  assert.equal(out.triageClasses, null);
});

test('черновик размечает КАЖДОЕ семейство и ничего не выдумывает', (t) => {
  const d = runDraft(
    fixture(t, {
      'design/app.css': '.btn{color:red} .btn--p{color:red} .bgt-row{color:red}',
      'design/index.jsx': 'const B = <button className="btn"/>;',
    }),
  );
  assert.deepEqual(Object.keys(d.families).sort(), ['bgt', 'btn']);
});

// ── 5. Счётчики объектов (TRIP-341 PR 0) ────────────────────────────────────
/**
 * ЗАЧЕМ ЭТИ ТЕСТЫ. Числа объектов - это то, по чему режутся подзадачи 05 и 06,
 * и до сих пор ни одно из них не воспроизводилось: «ряд 250/113» против
 * «348/108», «поверхность 97/91» против «242/97». Разбор показал, что стороны
 * не спорили, а считали РАЗНОЕ - у них расходились предикат, единица счёта и
 * периметр. Поэтому каждый предикат тут пинится ГРАНИЦЕЙ: не «сколько нашлось»,
 * а «что входит И ЧТО НЕ ВХОДИТ». Проверка «число совпало с эпиком» доказывала
 * бы ровно ничего - на токенах уже был случай, когда правильная и сломанная
 * реализации печатали одну и ту же цифру 163.
 */

const objectsOf = (dir) => run(dir).objects;
const css = (body) => ({ 'design/app.css': body, 'design/catalog.json': '{"families":{}}' });

test('РЯД: flex и inline-flex входят, колонка НЕ входит', (t) => {
  const o = objectsOf(
    fixture(t, css(`
      .a-row { display: flex; gap: 8px; }
      .b-row { display: inline-flex; align-items: center; }
      .c-col { display: flex; flex-direction: column; }
      .d-none { display: block; }`)),
  );
  assert.equal(o.row.rules, 2, 'колонка и block не ряд');
  assert.equal(o.col.rules, 1);
});

test('РЯД: ряд БЕЗ gap - всё равно ряд (отвергнутая альтернатива «+gap обязателен»)', (t) => {
  // Требование gap выкинуло бы 45 живых правил, которые как раз и надо
  // переселить на .row - то есть предикат занизил бы собственный объём работ.
  const o = objectsOf(fixture(t, css('.a-row { display: flex; align-items: center; }')));
  assert.equal(o.row.rules, 1);
});

test('КОЛОНКА: column-reverse - та же колонка, а не второй объект', (t) => {
  const o = objectsOf(
    fixture(t, css('.a-c { display:flex; flex-direction: column; } .b-c { display:flex; flex-direction: column-reverse; }')),
  );
  assert.equal(o.col.rules, 2);
  assert.equal(o.row.rules, 0, 'column-reverse не должен попасть в ряд');
});

test('СЕТКА: grid+place-items - это ПЛИТКА, а не сетка', (t) => {
  // Без этого условия два объекта считали бы друг друга: из 127 живых
  // `display:grid` 87 - квадрат с центрированной иконкой.
  const o = objectsOf(
    fixture(t, css(`
      .a-g { display: grid; grid-template-columns: 1fr 1fr; }
      .b-t { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; }`)),
  );
  assert.equal(o.grid.rules, 1, 'квадрат с place-items не сетка');
  assert.equal(o.tile.rules, 1);
});

test('ОБРЕЗКА: line-clamp - тот же объект, что ellipsis', (t) => {
  const o = objectsOf(
    fixture(t, css('.a-t { text-overflow: ellipsis; overflow: hidden; } .b-t { -webkit-line-clamp: 2; }')),
  );
  assert.equal(o.trunc.rules, 2);
});

test('ПОВЕРХНОСТЬ: радиус+фон БЕЗ контура - это пятно, не поверхность', (t) => {
  // Одних «радиус+фон» 176, и туда попадает каждая плитка и каждый бейдж.
  const o = objectsOf(
    fixture(t, css(`
      .a-s { border-radius: 12px; background: #fff; border: 1px solid #eee; }
      .b-s { border-radius: 12px; background: #fff; box-shadow: 0 1px 2px #0001; }
      .c-spot { border-radius: 12px; background: #fff; }`)),
  );
  assert.equal(o.surface.rules, 2, 'тень ИЛИ рамка - контур; без них это пятно');
});

test('ПЛИТКА: квадрат считается по СТРОКЕ значения, поэтому var()==var() работает', (t) => {
  const o = objectsOf(
    fixture(t, css(`
      .a-t { width: var(--tile); height: var(--tile); border-radius: 8px; place-items: center; display: grid; }
      .b-t { width: 40px; height: 41px; border-radius: 8px; place-items: center; display: grid; }`)),
  );
  assert.equal(o.tile.rules, 1, '40 и 41 - не квадрат; вычислять calc() значило бы завести третий парсер');
});

test('ПОДЪЁМ: тень на ховере - это подсветка, НЕ подъём', (t) => {
  // Смешение раздувает счёт с 24 до 35 и подмешивает в 06 работу яруса тинта.
  const o = objectsOf(
    fixture(t, css('.a-l:hover { transform: translateY(-2px); } .b-h:hover { box-shadow: 0 4px 8px #0002; }')),
  );
  assert.equal(o.lift.rules, 1);
});

test('ТОЛЬКО ЦВЕТ / ТОЛЬКО ОТСТУП: одна посторонняя строка выводит блок из счёта', (t) => {
  const o = objectsOf(
    fixture(t, css(`
      .a-c { color: red; background: blue; }
      .b-c { color: red; padding: 4px; }
      .c-s { margin-top: 8px; gap: 4px; }`)),
  );
  assert.equal(o.colorOnly.rules, 1);
  assert.equal(o.spaceOnly.rules, 1);
});

// ── Единица счёта: САМАЯ ДОРОГАЯ ГРАНИЦА ────────────────────────────────────

test('★ ДУБЛИ: список через запятую - ОДИН блок, а не N дублей', (t) => {
  // ЭТО ГЛАВНЫЙ ТЕСТ СЕКЦИИ. При счёте по СЕЛЕКТОРУ топ «дублей» в живом репо -
  // это 199× и 82× канона типографики (app.css:895-977), то есть ровно та
  // форма, к которой TRIP-165/183 сводили текст и которую сторожит
  // check:design. Список селекторов И ЕСТЬ схлопнутое состояние; PR,
  // порезанный по этому числу, пошёл бы разбирать дизайн-систему - метрика
  // назначила бы работой собственный ответ.
  const out = run(
    fixture(t, css('.a-x, .b-x, .c-x { color: red; font-size: 12px; }')),
  );
  assert.equal(out.dupSets, 0, 'ко-селекторный канон - это НЕ дубль');
  assert.equal(out.dupSetsCrossFamily, 0);
});

test('ДУБЛИ: два ОТДЕЛЬНЫХ блока с тем же набором - настоящий дубль', (t) => {
  const out = run(
    fixture(t, css('.a-x { color: red; font-size: 12px; } .b-x { color: red; font-size: 12px; }')),
  );
  assert.equal(out.dupSetsCrossFamily, 1);
  assert.equal(out.dupSetRulesCrossFamily, 2);
});

test('ДУБЛИ: одно и то же значение в РАЗНЫХ @media - не дубль', (t) => {
  // Иначе мобильное и десктопное объявление схлопнутся в «дубль», которым они
  // не являются - та же дыра, что ловили мутацией на гарде 2p.
  const out = run(
    fixture(t, css(`
      .a-x { color: red; font-size: 12px; }
      @media (max-width: 640px) { .b-x { color: red; font-size: 12px; } }`)),
  );
  assert.equal(out.dupSets, 0);
});

test('ДУБЛИ: набор внутри ОДНОГО семейства не идёт в «работу»', (t) => {
  const out = run(
    fixture(t, css('.a-x { color: red; gap: 2px; } .a-y { color: red; gap: 2px; }')),
  );
  assert.equal(out.dupSets, 1, 'набор виден');
  assert.equal(out.dupSetsCrossFamily, 0, 'но унификации между семействами тут нет');
});

test('ДУБЛИ: одно свойство - это твик, а не объект', (t) => {
  const out = run(fixture(t, css('.a-x { color: red; } .b-x { color: red; }')));
  assert.equal(out.dupSets, 0);
});

// ── Потомковые правила на примитивах (§12 Б, закон 3) ───────────────────────

const CATALOG = '{"families":{"btn":"canon","card":"canon","badge":"canon","scr":"triage","tile":"canon"}}';

test('★ ЗАКОН 3: составной селектор - НЕ потомство (канон СПРАВА, иначе тест инертен)', (t) => {
  // Первая редакция счётчика считала «классов в селекторе больше одного» и
  // записывала в нарушения каждый модификатор и каждое состояние - число
  // раздувалось с 61 до 153. Потомство определяется КОМБИНАТОРОМ.
  //
  // ⚠ ПЕРВАЯ РЕДАКЦИЯ ЭТОГО ТЕСТА БЫЛА ИНЕРТНА, и нашла это мутация, а не
  // чтение. Фикстура была `.btn.is-on`: под мутацией «потомство = 2+ класса»
  // стилизуемым становился ПОСЛЕДНИЙ класс `is-on`, семейства `is` в фикстурном
  // каталоге нет - и блок отсеивался, но ПО ДРУГОЙ ПРИЧИНЕ. Вердикт совпадал,
  // проверка не проверяла ничего. Ловушка срабатывает, только когда канон-класс
  // стоит в составном селекторе ПОСЛЕДНИМ - поэтому здесь `.scr-a.btn`, и это
  // же живая форма записи (`className="btn scr-a"`). Тот же класс ошибки, что с
  // `.gone-row` у гарда 2n: фикстура, не попадающая в проверяемую ветку.
  const out = run(
    fixture(t, {
      'design/app.css': '.scr-a.btn { background: red; } .btn.scr-a:hover { background: blue; }',
      'design/catalog.json': CATALOG,
    }),
  );
  assert.equal(out.primitiveReach.violations, 0, 'составной селектор - один элемент, никто никуда не дотягивался');
});

test('ЗАКОН 3: экран дотянулся и ОБЪЯВИЛ свойство - нарушение', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.scr-a .btn { background: red; }', 'design/catalog.json': CATALOG }),
  );
  assert.equal(out.primitiveReach.violations, 1);
  assert.deepEqual(out.primitiveReach.byFamily, { scr: 1 });
});

test('ЗАКОН 3: дотянулся и переопределил ТОЛЬКО ручку - это РАЗРЕШЕНО', (t) => {
  // Живых таких сегодня ноль, и именно поэтому ветка обязана быть на фикстуре:
  // непокрытая ветка с нулём в проде неотличима от мёртвого кода. По мере
  // работы 06 правила должны переезжать из violations СЮДА - это направление
  // движения, а не украшение отчёта.
  const out = run(
    fixture(t, { 'design/app.css': '.scr-a .tile { --tile: 44px; }', 'design/catalog.json': CATALOG }),
  );
  assert.equal(out.primitiveReach.violations, 0);
  assert.equal(out.primitiveReach.varOnly, 1);
});

test('ЗАКОН 3: канон внутри канона - композиция ДС, отдельная строка', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.card .badge { background: red; }', 'design/catalog.json': CATALOG }),
  );
  assert.equal(out.primitiveReach.violations, 0, 'это не долг экранов');
  assert.equal(out.primitiveReach.canonIntoCanon, 1);
});

test('ЗАКОН 3: дотянулись до НЕ-канона - вообще не про этот счётчик', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.scr-a .scr-b { background: red; }', 'design/catalog.json': CATALOG }),
  );
  assert.equal(out.primitiveReach.violations, 0);
});

// ── Периметр и громкость ────────────────────────────────────────────────────

test('ОБЪЕКТЫ считаются в том же периметре, что классы и семейства', (t) => {
  // Иначе получается «250 правил в периметре / 113 семейств по всему src» -
  // строка, смешивающая оси внутри себя, с которой всё и началось.
  const o = objectsOf(
    fixture(t, {
      'design/app.css': '.a-row { display: flex; }',
      'pages/login.css': '.b-row { display: flex; } .c-row { display: flex; }',
      'design/catalog.json': '{"families":{}}',
    }),
  );
  assert.equal(o.row.rules, 1, 'login.css вне периметра');
});

test('НЕРАЗОБРАННЫЙ CSS громкий: «нечего считать» != «посчитано, чисто»', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.a-row { display: flex; }', 'design/b.css': '.x { color:', 'design/catalog.json': '{"families":{}}' }),
  );
  assert.equal(out.cssParseFailures.length, 1);
  assert.match(out.cssParseFailures[0], /b\.css/);
});

test('РАСПРЕДЕЛЕНИЕ ПО СЕМЕЙСТВАМ печатается - по нему режутся 05 и 06', (t) => {
  const o = objectsOf(
    fixture(t, css('.aa-1 { display:flex; } .aa-2 { display:flex; } .bb-1 { display:flex; }')),
  );
  assert.deepEqual(o.row.byFamily, { aa: 2, bb: 1 });
});
