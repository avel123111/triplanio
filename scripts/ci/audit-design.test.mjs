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

const CATALOG_T = '{"families":{"btn":"canon","card":"canon","t":"canon","scr":"triage"}}';
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

test('★★ ЗАКОН 3: СО-СЕЛЕКТОРНЫЙ КАНОН ТИПОГРАФИКИ вычтен, а не засчитан в долг', (t) => {
  // Единый источник текст-стилей объявлен списком со-селекторов: рядом с
  // `.t-subheading` перечислены элементы, которым канон ПЕРЕНАЗНАЧАЕТ стиль.
  // Предикат читает такую строку как «экран дотянулся до примитива .t», хотя
  // это механизм самой ДС. Захрапови сырое число - считали бы долгом
  // собственный канон (в этом эпике наивный предикат целился в свой канон уже
  // дважды: 199 «дублей» и «canon = одиночки»).
  const out = run(
    fixture(t, {
      'design/app.css': '.t-sub, .scr-a .t-ui { font-size: 13px; }',
      'design/catalog.json': CATALOG_T,
    }),
  );
  assert.equal(out.primitiveReach.violations, 0, 'это канон, а не долг экрана');
  assert.equal(out.primitiveReach.canonTypography, 1, 'и вычет обязан быть ВИДЕН отдельной строкой');
});

test('★★ ЗАКОН 3: экран, ужимающий кегль примитива ВНЕ канон-правила, - нарушение', (t) => {
  // Предикат выбран ЗАМЕРОМ, и два кандидата различаются ровно этим случаем:
  // «правило объявляет только типографические свойства» даёт 14 и прощает
  // `.ncal-ev .t { font-size }` - живой дефект; «правило ЕСТЬ канон: среди его
  // селекторов есть голый .t-*» даёт 13 и его ловит. Взят второй.
  const out = run(
    fixture(t, { 'design/app.css': '.scr-a .t-ui { font-size: 9px; }', 'design/catalog.json': CATALOG_T }),
  );
  assert.equal(out.primitiveReach.violations, 1);
  assert.equal(out.primitiveReach.canonTypography, 0);
});

test('★★ ЗАКОН 3: со-селектор `.t-*` НЕ прячет нетипографическое нарушение', (t) => {
  // Канал обхода у ЗАХРАПОВЛЕННОГО числа: проверяй мы только «есть голый .t-*
  // среди селекторов», допиши такой со-селектор - и любое нарушение закона 3
  // исчезнет из метрики пола. Нашёл `code-simplifier` прогоном: замерено 0.
  const out = run(
    fixture(t, { 'design/app.css': '.t-sub, .scr-a .card { padding: 99px; }', 'design/catalog.json': CATALOG_T }),
  );
  assert.equal(out.primitiveReach.violations, 1, 'padding - не типографика, вычету не подлежит');
  assert.equal(out.primitiveReach.canonTypography, 0);
});

test('★ ЗАКОН 3: печатается, сколько из вычтенного БЫЛО БЫ долгом', (t) => {
  // «вычтено 13» рядом с «53» читается как «на самом деле 66». Неправда: долгом
  // из них были бы единицы, и это число обязано стоять рядом.
  const out = run(
    fixture(t, {
      'design/app.css': '.t-sub, .scr-a .t-ui { font-size: 13px; }\n.t-two, .card { font-size: 12px; }',
      'design/catalog.json': CATALOG_T,
    }),
  );
  assert.equal(out.primitiveReach.canonTypography, 2);
  assert.equal(out.primitiveReach.canonTypographyWouldViolate, 1, 'второе правило не было бы нарушением и без вычета');
});

test('★ ЗАКОН 3: граница языка берётся из AUDIT_CANON_FAMILIES, когда её задали', (t) => {
  // Пол 2o меряет HEAD канон-набором БАЗЫ: число зависит от каталога по
  // построению, и переклейка семьи двигает его в ОБЕ стороны без единой строки
  // CSS (замерено: `bgt` triage→canon дал 53 → 47, то есть молча ЗАБАНКОВАЛ бы
  // прогресс). Одна мерка на две стороны оставляет под наблюдением правки CSS.
  const dir = fixture(t, { 'design/app.css': '.scr-a .btn { background: red; }', 'design/catalog.json': CATALOG_T });
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    env: { ...process.env, AUDIT_ROOT: dir, AUDIT_CANON_FAMILIES: 'card' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.primitiveReach.violations, 0, 'btn не канон по ПЕРЕДАННОЙ границе');
  assert.deepEqual(out.canonFamiliesUsed, ['card']);
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

// ── 6. Доля «приложение собрано из системы» (TRIP-337 §1) ───────────────────
/** ГЛАВНОЕ ЧИСЛО ЭПИКА, и предикат у него дороже обычного: у «доли» три оси
 *  (что в числителе, что в знаменателе, какой периметр), и на живом дереве они
 *  дают 16.2% · 17.0% · 19.2% · 19.4% · 20.3% · 23.1% — ровно тот разброс, из-за
 *  которого §12 требует кода раньше числа. Каждая граница ниже пиньется своим
 *  тестом, потому что каждая из них меняет ответ.
 *
 *  ★ И ОДНА ИЗ НИХ ЦЕЛИТСЯ В СОБСТВЕННЫЙ КАНОН — тест «внутренности ДС»
 *  ровно про это: `Btn` внутри собран из `<button>`, и наивный предикат
 *  записывает систему в долг сама себе. */

test('элемент из design/** — в числителе, сырой тег — в знаменателе', (t) => {
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Btn = () => null;',
      'pages/S.jsx': "import { Btn } from '@/design';\nexport default () => (<div><Btn /></div>);",
    }),
  );
  assert.equal(out.dsShare.ds, 1);
  assert.equal(out.dsShare.host, 1);
  assert.equal(out.dsShareBp, 5000, 'половина листьев взята из системы');
});

test('импорт ДС узнаётся и относительным путём, не только через @/', (t) => {
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Btn = () => null;',
      'pages/S.jsx': "import { Btn } from '../design/index.jsx';\nexport default () => <Btn />;",
    }),
  );
  assert.equal(out.dsShare.ds, 1);
  assert.equal(out.dsShareBp, 10000);
});

test('★ ВНУТРЕННОСТИ ДС В ЗНАМЕНАТЕЛЬ НЕ ПОПАДАЮТ — иначе предикат целится в свой канон', (t) => {
  // `Btn` обязан быть собран из `<button>`: это система, а не долг. С её
  // потрохами в знаменателе 100% недостижимы ПО ПОСТРОЕНИЮ, а каждый новый
  // примитив ухудшает число - то есть метрика штрафует ровно ту работу,
  // ради которой заведена.
  const out = run(
    fixture(t, {
      'design/Btn.jsx': "export const Btn = () => (<button className='btn'><span /></button>);",
      'pages/S.jsx': "import { Btn } from '@/design/Btn.jsx';\nexport default () => <Btn />;",
    }),
  );
  assert.equal(out.dsShare.host, 0, 'button и span внутри примитива не считаются');
  assert.equal(out.dsShareBp, 10000);
  assert.equal(out.dsShare.implHost, 2, 'но они ПЕЧАТАЮТСЯ: свалить разметку экрана в design/ видно');
});

test('components/ui — в ЗНАМЕНАТЕЛЕ, не в числителе: переезд ui → design поднимает долю', (t) => {
  const legacy = run(
    fixture(t, {
      'components/ui/button.jsx': 'export const Button = () => null;',
      'pages/S.jsx': "import { Button } from '@/components/ui/button.jsx';\nexport default () => <Button />;",
    }),
  );
  assert.equal(legacy.dsShare.ui, 1);
  assert.equal(legacy.dsShareBp, 0, 'шадсн-остаток - это НЕ «собрано из системы»');

  const moved = run(
    fixture(t, {
      'design/button.jsx': 'export const Button = () => null;',
      'pages/S.jsx': "import { Button } from '@/design/button.jsx';\nexport default () => <Button />;",
    }),
  );
  assert.equal(moved.dsShareBp, 10000, 'тот же элемент после переезда - уже система');
});

test('★ своя композиция, вендор и локальный компонент НЕ считаются вовсе', (t) => {
  // Иначе гард краснеет на правильном ходе: разбиение экрана на подкомпоненты -
  // это фаза 09, а каждый новый <CityRow/> опускал бы долю.
  const out = run(
    fixture(t, {
      'components/MembersLens.jsx': 'export default () => null;',
      'pages/S.jsx':
        "import Lens from '@/components/MembersLens.jsx';\nimport { Check } from 'lucide-react';\n" +
        'const Row = () => null;\nexport default () => (<div><Lens /><Check /><Row /></div>);',
    }),
  );
  assert.equal(out.dsShare.host, 1, 'в знаменателе только div');
  assert.equal(out.dsShare.denominator, 1);
  assert.deepEqual(
    { app: out.dsShare.app, vendor: out.dsShare.vendor, local: out.dsShare.local },
    { app: 1, vendor: 1, local: 1 },
    'исключённые кучи ПЕЧАТАЮТСЯ поимённо, а не растворяются',
  );
});

test('потроха <svg> не считаются: это графика, заменить её примитивом нечем', (t) => {
  const out = run(
    fixture(t, { 'pages/S.jsx': 'export default () => (<div><svg><path /><g><circle /></g></svg></div>);' }),
  );
  assert.equal(out.dsShare.host, 1, 'только div');
  assert.equal(out.dsShare.svg, 4, 'svg + path + g + circle');
});

test('нерендерящий тег (<style>) не элемент интерфейса', (t) => {
  const out = run(fixture(t, { 'pages/S.jsx': 'export default () => (<div><style>{".a{}"}</style></div>);' }));
  assert.equal(out.dsShare.host, 1);
});

test('периметр тот же, что у классов: лендинг и публичка вне числа', (t) => {
  const out = run(
    fixture(t, {
      'pages/PublicTrip.jsx': 'export default () => (<div><div><div /></div></div>);',
      'pages/S.jsx': 'export default () => <div />;',
    }),
  );
  assert.equal(out.dsShare.host, 1, 'три div публички не считаются - тронуть их нельзя до подзадачи 10');
});

test('★ пустое дерево даёт null, а не 0: «мерить нечего» != «померили, чисто»', (t) => {
  const out = run(fixture(t, { 'a.css': ':root { --x: 1px; }' }));
  assert.equal(out.dsShareBp, null);
  assert.equal(out.dsShare.denominator, 0);
});

test('★ ЦЕНА ГРАНИЦЫ НАЗВАНА: локальный шим с именем из ДС печатается отдельно', (t) => {
  // 41 вызов рукописного <Label> виден как ОДИН сырой <label> в месте
  // объявления. Дыра границы «своя композиция не считается» - и она названа
  // строкой отчёта, а не спрятана в числе.
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Input = () => null;',
      'pages/S.jsx': 'const Input = () => (<input />);\nexport default () => (<div><Input /><Input /></div>);',
    }),
  );
  assert.equal(out.dsShare.shims.length, 1);
  assert.equal(out.dsShare.shims[0].name, 'Input');
  assert.equal(out.dsShare.shims[0].uses, 2);
});

test('<Dialog.Title/> считается по КОРНЮ имени, а не по последнему слову', (t) => {
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Dialog = () => null;',
      'pages/S.jsx': "import { Dialog } from '@/design';\nexport default () => (<Dialog.Title />);",
    }),
  );
  assert.equal(out.dsShare.ds, 1);
});

test('★ составное имя - ВСЕГДА компонент, регистр корня роли не играет', (t) => {
  // По грамматике JSX `<x.Y/>` не может быть host-тегом. Без этого `<theme.Icon/>`
  // (три живых случая в src) попадал в ЗНАМЕНАТЕЛЬ как «экран нарисовал сам», а
  // `<ds.Btn/>` при `import * as ds` - тоже, то есть предикат штрафовал ровно
  // тот ход, ради которого заведён.
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Btn = () => null;',
      'pages/S.jsx':
        "import * as ds from '@/design';\nimport { motion } from 'framer-motion';\n" +
        'const theme = {};\nexport default () => (<div><ds.Btn /><motion.div /><theme.Icon /></div>);',
    }),
  );
  assert.equal(out.dsShare.host, 1, 'сырой тег тут ровно один - div');
  assert.equal(out.dsShare.ds, 1, '<ds.Btn/> через `import * as` - это ДС');
  assert.equal(out.dsShare.vendor, 1, '<motion.div/> - вендор, а не разметка');
  assert.equal(out.dsShare.local, 1, '<theme.Icon/> - своя композиция');
  assert.equal(out.dsShare.denominator, 2);
});

test('★ ОДИН разбор на файл: непрочитанный файл называется РОВНО ОДИН раз', (t) => {
  // Ради этого и заведён кеш `astOf`: классы (1c/1d) и доля (1e) читают одно
  // дерево. Два разбора - два списка `parseFailures`, и гард 2o напечатал бы
  // «не разобрано 2 файла» там, где файл один - то есть соврал бы в том самом
  // отчёте, которым блокирует PR.
  const out = run(fixture(t, { 'pages/S.jsx': 'export const C = () => <div className={;;;}/>;' }));
  assert.equal(out.parseFailures.length, 1, out.parseFailures.join('\n'));
  assert.equal(out.dsShareBp, null, 'из нечитаемого файла элементов не взято ни одного');
});

test('шим узнаётся и у дефолтного экспорта ДС (`export default Icon`)', (t) => {
  const out = run(
    fixture(t, {
      'design/icons.jsx': 'const Icon = () => null;\nexport default Icon;',
      'pages/S.jsx': 'const Icon = () => (<i />);\nexport default () => (<div><Icon /></div>);',
    }),
  );
  assert.deepEqual(
    out.dsShare.shims.map((s) => s.name),
    ['Icon'],
    'иначе список шимов молчит про компоненты без имени в `export {…}`',
  );
});

test('ГРАНИЦА C: ре-экспорт через свой модуль выпадает из ОБЕИХ частей дроби', (t) => {
  // Заявлено в шапке §1e как ошибка в безопасную сторону; пиньется тестом,
  // чтобы «заявлено» и «так и работает» не разъезжались молча.
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Btn = () => null;',
      'lib/kit.js': "export { Btn } from '@/design';",
      'pages/S.jsx': "import { Btn } from '@/lib/kit.js';\nexport default () => (<div><Btn /></div>);",
    }),
  );
  assert.equal(out.dsShare.ds, 0, 'через посредника ДС не опознаётся');
  assert.equal(out.dsShare.app, 1, 'и в знаменатель тоже НЕ попадает');
  assert.equal(out.dsShare.denominator, 1, 'в знаменателе только div');
});

test('★ РАЗБИВКА ПО ТЕГУ: ею решается порядок фаз, поэтому она число, а не мнение', (t) => {
  // Доля двигается ровно одним способом - сырой тег стал компонентом ДС, -
  // поэтому вклад каждого тега считается из этой разбивки арифметикой.
  const out = run(
    fixture(t, {
      'design/index.jsx': 'export const Btn = () => null;',
      'pages/S.jsx':
        "import { Btn } from '@/design';\n" +
        'export default () => (<div><button /><button /><Btn /><Btn /><Btn /></div>);',
    }),
  );
  assert.deepEqual(out.dsShare.byTag, [['button', 2], ['div', 1]], 'по убыванию, только сырые теги');
  assert.deepEqual(out.dsShare.byComponent, [['Btn', 3]]);
});

test('РАЗБИВКА: теги внутри ДС и внутри svg в неё не попадают', (t) => {
  const out = run(
    fixture(t, {
      'design/Btn.jsx': 'export const Btn = () => (<button />);',
      'pages/S.jsx': "import { Btn } from '@/design/Btn.jsx';\nexport default () => (<div><svg><path /></svg><Btn /></div>);",
    }),
  );
  assert.deepEqual(out.dsShare.byTag, [['div', 1]], 'ни button из примитива, ни path из svg');
});

// ── 7. Классы, объявляющие раскладку (TRIP-388 · десятое число пола) ────────
/** Число, которым PR пересадки доказывает, что работа СДЕЛАНА, а не замаскирована
 *  пробросом `className`. Каждая граница предиката пиньется отдельно: подлежащее,
 *  фиксированный канон (а не каталог), периметр. */

test('★ ПОДЛЕЖАЩЕЕ: раскладку объявляет последняя ступень селектора, а не предок', (t) => {
  // Иначе `.te-x .row {display:flex}` двигал бы число у НЕТРОНУТОГО `.te-x`,
  // и «упало на те классы, которые тронул» перестало бы что-либо значить.
  const out = run(fixture(t, { 'design/app.css': '.te-x .bgt-head { display: flex; }' }));
  assert.deepEqual(out.layoutClasses.names, ['bgt-head']);
  assert.equal(out.layoutPrivateClasses, 1);
});

test('★★ СОСТАВНАЯ СТУПЕНЬ: объект, а не состояние - иначе два объекта схлопываются в одно имя', (t) => {
  // `.a-x.is-split` записывается на `a-x`. Запись на состояние дала бы одно имя
  // `is-split` на РАЗНЫЕ объекты: множество схлопнуло бы их в одну запись, и
  // тогда схлопывание одного число не роняет, а появление второго - не
  // поднимает. Мутация проходит насквозь.
  const out = run(
    fixture(t, { 'design/app.css': '.a-x.is-split { display: flex; } .b-x.is-split { display: flex; }' }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'b-x'], 'два объекта - две записи, а не одна на состоянии');
  assert.equal(out.layoutPrivateClasses, 2);
});

/** ★★★ ПОРЯДОК КЛАССОВ В СЕЛЕКТОРЕ - ЭТО ФОРМА ЗАПИСИ, А НЕ СОДЕРЖАНИЕ.
 *  Предикат, чувствительный к ней, снимается переписыванием места, а не работой:
 *  удержанное объявление раскладки, приколотое к примитиву, проезжает гейт.
 *  Пара тестов ниже пиньет ОБА этажа - саму ступень и ступень-предок; каждый
 *  красен на первой редакции (`classesIn(tail)[0]` / `styledClass`). */
test('★★★ ПОРЯДОК НЕ РЕШАЕТ: .row.bgt-head и .bgt-head.row дают одно и то же', (t) => {
  const primitiveFirst = run(fixture(t, { 'design/app.css': '.row.bgt-head { display: flex; }' }));
  const privateFirst = run(fixture(t, { 'design/app.css': '.bgt-head.row { display: flex; }' }));
  // Первая редакция брала ПЕРВЫЙ класс: примитивом вперёд отдавала канон `row`,
  // и приватный `bgt-head` пропадал из наблюдения совсем (0 против 1).
  assert.deepEqual(primitiveFirst.layoutClasses.names, ['bgt-head'], 'канон не заслоняет объект, стоя перед ним');
  assert.deepEqual(privateFirst.layoutClasses.names, primitiveFirst.layoutClasses.names);
  assert.equal(privateFirst.layoutPrivateClasses, primitiveFirst.layoutPrivateClasses);
});

test('★★★ ПОРЯДОК НЕ РЕШАЕТ и этажом выше: та же ступень в роли предка', (t) => {
  // `styledClass` (последний класс ВСЕГО селектора) отдал бы `bgt-head` в одном
  // написании и канон `row` в другом - та же дыра, просто в предке.
  const a = run(fixture(t, { 'design/app.css': '.row.bgt-head input { display: flex; }' }));
  const b = run(fixture(t, { 'design/app.css': '.bgt-head.row input { display: flex; }' }));
  assert.deepEqual(a.layoutClasses.names, ['bgt-head']);
  assert.deepEqual(b.layoutClasses.names, a.layoutClasses.names);
});

test('ступень из ДВУХ объектов записывается на оба - иначе ответ снова зависит от порядка', (t) => {
  // Ни один из двух не канон и не состояние, «первый» тут ничем не лучше
  // «второго»: выбрать одного значит вернуть чувствительность к написанию.
  // Цена - лишнее имя, и она в БЕЗОПАСНУЮ сторону: пол храповит число вниз,
  // поэтому лишнее имя краснеет, а не занижает молча.
  const out = run(fixture(t, { 'design/app.css': '.a-x.b-x { display: flex; }' }));
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'b-x']);
});

test('★★★ ПОРЯДОК НЕ РЕШАЕТ и в ФОЛБЭКЕ: .row.is-open против .is-open.row', (t) => {
  // Самая узкая версия дыры и потому самая живучая: у ступени НЕ ОСТАЁТСЯ ни
  // одного объекта (канон + состояние), работает запасная ветка «на первый».
  // Пока канон отсеивался вместе с состоянием, она давала `row` (0 приватных) в
  // одном написании и `is-open` (1 приватный) в другом — то есть порядок решал,
  // а в ЗАХРАПОВЛЕННОЕ число попадало имя СОСТОЯНИЯ, которого PR не трогал.
  const canonFirst = run(fixture(t, { 'design/app.css': '.row.is-open { display: flex; }' }));
  const stateFirst = run(fixture(t, { 'design/app.css': '.is-open.row { display: flex; }' }));
  assert.deepEqual(canonFirst.layoutClasses.names, [], 'у примитива с состоянием приватного объекта нет');
  assert.deepEqual(stateFirst.layoutClasses.names, canonFirst.layoutClasses.names);
  assert.equal(stateFirst.layoutPrivateClasses, canonFirst.layoutPrivateClasses);
});

test('ступень из ОДНИХ канон-классов записывается на канон, а не теряется', (t) => {
  // Композиция примитивов (`.row.grow`) — законная разметка, и объявление
  // раскладки на ней принадлежит канону. Потерять её нельзя: `total` — это то,
  // с чем сверяется снятие приватных, и дыра в нём тихо занижает базу.
  const out = run(fixture(t, { 'design/app.css': '.row.grow { display: flex; }' }));
  assert.equal(out.layoutClasses.total, 2);
  assert.deepEqual(out.layoutClasses.names, [], 'канон в приватные не попадает');
});

test('канон СЧИТАЕТСЯ в total даже рядом с приватным - иначе его снятие не с чем сверить', (t) => {
  // `.row.bgt-head` — это ДВА объявляющих имени на одном элементе. Приватный
  // едет в список, канон в общий счёт; если канон выкинуть ещё на подлежащем,
  // фолбэк перестаёт быть симметричным (тест выше).
  const out = run(fixture(t, { 'design/app.css': '.row.bgt-head { display: flex; }' }));
  assert.equal(out.layoutClasses.total, 2);
  assert.deepEqual(out.layoutClasses.names, ['bgt-head']);
});

test('состояние БЕЗ приставки is- остаётся объектом - граница названа, и она краснит, а не занижает', (t) => {
  // `on`/`active` предикат состоянием не считает (замер: правил раскладки с
  // составной ступенью в периметре одно, бесприставочных среди них ноль).
  // Важно, что объект `a-x` записан РЯДОМ, а не вместо: схлопнуть его гард
  // по-прежнему видит.
  const out = run(fixture(t, { 'design/app.css': '.a-x.on { display: flex; }' }));
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'on']);
});

test('⚠️ ступень БЕЗ класса: раскладку объявляет голый тег, запись идёт на класс-предок', (t) => {
  // Граница названа в §3a: снять `display` у `.checkbox input` можно только
  // правкой набора правил `.checkbox`, поэтому объявление наблюдается на нём.
  // «Не считать вовсе» опускало бы число БЕЗ работы - в ту сторону, куда его
  // храповит пол.
  const out = run(fixture(t, { 'design/app.css': '.checkbox input { display: flex; }' }));
  assert.deepEqual(out.layoutClasses.names, ['checkbox']);
});

test('селектор без единого класса в число не попадает вовсе', (t) => {
  // `:root`, `div > *`, шаг кейфрейма - подлежащего-класса нет, приписать
  // объявление некому. Считать их «нулевым классом» значило бы завести запись,
  // которую ни один PR не может убрать.
  const out = run(
    fixture(t, {
      'design/app.css':
        ':root { display: flex; } div > * { display: flex; } @keyframes k { from { display: flex; } } .a-x { display: flex; }',
    }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x']);
  assert.equal(out.layoutClasses.total, 1);
});

test('@media НЕ удваивает: единица счёта - ИМЯ класса, а не правило', (t) => {
  // Иначе перенос правила в мобильную ветку (или из неё) двигал бы число без
  // единого схлопнутого класса - краснота на ходе, который ничего не ухудшает.
  const out = run(
    fixture(t, {
      'design/app.css': '.a-x { display: flex; } @media (max-width: 640px) { .a-x { display: grid; } }',
    }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x']);
});

test('канон раскладки в приватные НЕ попадает - и это ФИКСИРОВАННЫЙ список, не каталог', (t) => {
  // У `primitiveReach` зависимость от каталога означает, что переклейка
  // triage → canon двигает число без строки CSS. Здесь список зашит, поэтому
  // добавление примитива число не двигает, а новый приватный класс - двигает.
  const out = run(
    fixture(t, {
      'design/app.css': '.row { display: flex; } .col { display: flex; } .grid--2 { display: grid; } .bgt-head { display: flex; }',
      'design/catalog.json': '{"families":{"row":"triage","col":"triage","grid":"triage","bgt":"triage"}}',
    }),
  );
  assert.equal(out.layoutClasses.total, 4);
  assert.deepEqual(out.layoutClasses.names, ['bgt-head'], 'канон row/col/grid не приватный даже со статусом triage');
});

test('inline-flex и inline-grid - тоже раскладка', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.a-x { display: inline-flex; } .b-x { display: inline-grid; } .c-x { display: block; }' }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'b-x']);
});

test('периметр тот же: лендинг и вход в число не попадают', (t) => {
  const out = run(
    fixture(t, { 'design/app.css': '.a-x { display: flex; }', 'pages/login.css': '.auth-row { display: flex; }' }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x']);
});

test('список печатается, а не только счёт - им PR доказывает, ЧТО именно упало', (t) => {
  const out = run(fixture(t, { 'design/app.css': '.z-x { display: grid; } .a-x { display: flex; }' }));
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'z-x'], 'по алфавиту, чтобы дифф двух прогонов читался');
});

// ── 7b. Пять свойств, а не одно (TRIP-388 · починка предиката) ──────────────
/** Первая редакция смотрела ТОЛЬКО `display`, то есть проверяла пятую часть
 *  правила «примитив владеет display/gap/align-items/justify-content/
 *  flex-direction». Класс, приехавший через `className` к `.row` и оставивший
 *  себе зазор с выравниванием, получал `display` от примитива и в число не
 *  попадал - гейт «число упало» зеленел на несделанной работе. Замер по живому
 *  дереву: таких классов 92 из 440. */

test('★ класс БЕЗ display, объявляющий только зазор, - это раскладка', (t) => {
  // Ровно случай пересадки: `<Row className="bgt-head">`, `display` приезжает
  // от примитива, а зазор остался у экранного класса. Под старым предикатом
  // такой класс был невидим, и это была не редкость, а типовой остаток фазы 05.
  const out = run(fixture(t, { 'design/app.css': '.bgt-head { gap: 8px; }' }));
  assert.deepEqual(out.layoutClasses.names, ['bgt-head']);
});

test('★ остальные три свойства считаются сами по себе, без display', (t) => {
  const out = run(
    fixture(t, {
      'design/app.css':
        '.a-x { align-items: center; } .b-x { justify-content: space-between; } .c-x { flex-direction: column; }',
    }),
  );
  assert.deepEqual(out.layoutClasses.names, ['a-x', 'b-x', 'c-x']);
});

test('★★ ФОРМА ЗАПИСИ ОТВЕТ НЕ МЕНЯЕТ: сокращённая запись считается наравне с длинной', (t) => {
  // Проверочный вопрос к любому числу: можно ли, ничего не меняя по существу,
  // переписать место так, чтобы число стало другим? Для пяти длинных имён ответ
  // был «да» четырьмя способами. `place-items` в репозитории ЖИВОЙ (§3, девять
  // семейств), поэтому это не гипотеза.
  const long = run(
    fixture(t, {
      'design/app.css':
        '.a-x { gap: 8px; } .b-x { align-items: center; } .c-x { justify-content: center; } .d-x { flex-direction: column; }',
    }),
  );
  const short = run(
    fixture(t, {
      'design/app.css':
        '.a-x { row-gap: 8px; column-gap: 8px; } .b-x { place-items: center; } .c-x { place-content: center; } .d-x { flex-flow: column wrap; }',
    }),
  );
  assert.deepEqual(long.layoutClasses.names, ['a-x', 'b-x', 'c-x', 'd-x']);
  assert.deepEqual(short.layoutClasses.names, long.layoutClasses.names, 'сокращение прячет класс от числа');
});

test('⚠️ ГРАНИЦА: display:none и display:block - это видимость и поток, а не раскладка', (t) => {
  // Считать их значило бы набить захраповленное число классами, которых ни один
  // PR пересадки не тронет, и сделать его подвижным от посторонней правки.
  // Граница названа вслух, потому что она НЕ бесплатна: `.x{display:block}`,
  // приехавший через className, примитив ломает, а число этого не покажет.
  const out = run(
    fixture(t, {
      'design/app.css': '.a-x { display: none; } .b-x { display: block; } .c-x { display: flex; }',
    }),
  );
  assert.deepEqual(out.layoutClasses.names, ['c-x']);
});

test('свойство раскладки внутри @media считается так же, как в базовом контексте', (t) => {
  // Мобильная ветка - самое узкое место вёрстки; предикат, слепой к ней, уводил
  // бы из наблюдения ровно те правила, которые труднее всего заметить глазами.
  const out = run(fixture(t, { 'design/app.css': '@media (max-width: 640px) { .a-x { gap: 4px; } }' }));
  assert.deepEqual(out.layoutClasses.names, ['a-x']);
});

// ── §1f · Двойное владение раскладкой (TRIP-388) ────────────────────────────
/** ★ ЗАЧЕМ ЭТИ ТЕСТЫ СУЩЕСТВУЮТ. Пересадка четырёх экранов на примитивы
 *  сдвинула ровно одно из десяти чисел пола (долю из ДС) и не тронула ни одно
 *  из остальных: примитив встал ПОВЕРХ класса, который продолжает владеть
 *  раскладкой. Ни один гард этого не видит - у 2o все числа «только вниз», а
 *  PR, который только добавляет, ни одного не двигает.
 *
 *  ★★ И ЧИСЛО ЗДЕСЬ УЖЕ РАСХОДИЛОСЬ ТРИЖДЫ: 38, 56 и 55 в трёх прогонах по
 *  одному дереву. Никто не ошибался - предиката не было ни у одного. Последний
 *  (55) считал регуляркой `<(Row|Col)\b[^>]*>` и терял узлы, у которых `>`
 *  встречается ВНУТРИ атрибутов (`onClick={() => …}`). Поэтому предикат пинится
 *  фикстурами, а не сверкой с числом на живом репозитории. */

const LAYOUT_MODULE = 'export const Row = () => null;\nexport const Col = () => null;\n';

test('§1f: примитив + приватный класс, объявляющий раскладку = двойное владение', (t) => {
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE,
      'design/app.css': '.acct-plan { display: flex; gap: 9px; }',
      'Screen.jsx': 'import { Row } from "@/design";\nexport const S = () => <Row className="acct-plan" />;\n',
    }),
  );
  assert.equal(out.dualLayout.measured, true);
  assert.equal(out.dualLayout.nodes, 1);
  assert.deepEqual(out.dualLayout.classes, ['acct-plan']);
});

test('§1f: класс БЕЗ раскладки через className - это НЕ долг (граница правила)', (t) => {
  // Апрув п.3 разрешает через className ровно это: цвет, фон, крючок экрана.
  // Считать их долгом значило бы объявить проброс класса вне закона, а на нём
  // держится вся пересадка.
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE,
      'design/app.css': '.acct-plan { color: red; background: blue; }',
      'Screen.jsx': 'import { Row } from "@/design";\nexport const S = () => <Row className="acct-plan" />;\n',
    }),
  );
  assert.equal(out.dualLayout.nodes, 0);
});

test('§1f: канон-класс на примитиве не долг - долг только ПРИВАТНЫЙ', (t) => {
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE,
      'design/app.css': '.row { display: flex; gap: 12px; } .row--g4 { gap: 4px; }',
      'Screen.jsx': 'import { Row } from "@/design";\nexport const S = () => <Row className="row--g4" />;\n',
    }),
  );
  assert.equal(out.dualLayout.nodes, 0);
});

test('§1f: одноимённый ЛОКАЛЬНЫЙ Row - не примитив системы', (t) => {
  // Иначе в долг попадёт работа, которой там нет: шим чужого файла системе не
  // принадлежит и её раскладкой не владеет.
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE,
      'design/app.css': '.acct-plan { display: flex; gap: 9px; }',
      'Screen.jsx': 'const Row = () => null;\nexport const S = () => <Row className="acct-plan" />;\n',
    }),
  );
  assert.equal(out.dualLayout.nodes, 0);
});

test('§1f: класс виден в шаблоне, конкатенации и cn() - иначе слепое пятно', (t) => {
  // Ровно та форма, на которой уже терялся `.pcard` в зоне 3 фазы 05.
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE,
      'design/app.css': '.a-row { display: flex; } .b-row { gap: 4px; } .c-row { align-items: center; }',
      'Screen.jsx':
        'import { Row, Col } from "@/design";\n' +
        'export const S = ({ on }) => <>\n' +
        '  <Row className={`a-row${on ? " is-on" : ""}`} onClick={() => go()} />\n' +
        '  <Col className={"b-row" + (on ? " x" : "")} />\n' +
        '  <Row className={cn("c-row", on && "y")} />\n' +
        '</>;\n',
    }),
  );
  assert.equal(out.dualLayout.nodes, 3);
  assert.deepEqual(out.dualLayout.classes, ['a-row', 'b-row', 'c-row']);
});

test('§1f: без Layout.jsx число НЕ ИЗМЕРЕНО, а не ноль', (t) => {
  // «Нечего мерить» и «померено, чисто» не должны печатать одинаковый вердикт -
  // правило, которым уже поймана дыра в 2l.
  const out = run(
    fixture(t, {
      'design/app.css': '.acct-plan { display: flex; gap: 9px; }',
      'Screen.jsx': 'import { Row } from "@/design";\nexport const S = () => <Row className="acct-plan" />;\n',
    }),
  );
  assert.equal(out.dualLayout.measured, false);
  assert.equal(out.dualLayout.nodes, 0);
});

test('§1f: шестой примитив подхватывается из модуля, а не из списка в скрипте', (t) => {
  const out = run(
    fixture(t, {
      'design/Layout.jsx': LAYOUT_MODULE + 'export const Deck = () => null;\n',
      'design/app.css': '.acct-plan { display: grid; }',
      'Screen.jsx': 'import { Deck } from "@/design";\nexport const S = () => <Deck className="acct-plan" />;\n',
    }),
  );
  assert.equal(out.dualLayout.nodes, 1);
});
