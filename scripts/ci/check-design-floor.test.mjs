#!/usr/bin/env node
/**
 * Tests for CI guard 2o (scripts/ci/check-design-floor.mjs).
 *
 * WHY (TRIP-337 §9). The repo has twelve guards and tests for three. 2l shipped
 * green with THREE bypasses, and every one of them lived in the I/O plumbing —
 * not in the counting. So this file exercises the plumbing end to end: a
 * throwaway git repo, the guard as a SUBPROCESS, assertions on exit codes.
 *
 * The division of labour is deliberate:
 *   • what counts as a class / namespace / inline / token is pinned in
 *     audit-design.test.mjs, against AUDIT_ROOT fixtures;
 *   • that the ceiling is the base branch, survives a rename of nothing, cannot
 *     be granted twice, and never goes green without measuring — is pinned here.
 *
 * ★ THE TEST THAT IS THE WHOLE POINT is "classes down while namespaces up".
 * That is not a hypothetical: it is exactly what the previous attempt did, and
 * it reported success (TRIP-337 §4). A per-metric ratchet would wave it through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-design-floor.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  if (body === null) {
    rmSync(full, { force: true }); // "this side has no such file"
    return;
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Since TRIP-340 a tree with no `src/design/catalog.json` is RED on HEAD — that
 *  is the point of the fifth metric, and it would otherwise turn every fixture
 *  here into a test of the catalog rather than of the thing it is named for. So
 *  each side gets a catalog covering its own families, filed `triage`, unless
 *  the test states one itself (or `null` to say "this side has none").
 *
 *  This re-derives "what is a family" in test support, which is a duplicate —
 *  but a self-checking one: get it wrong and the guard reports the family as
 *  unfiled and the test goes RED. It cannot go quietly green. */
const CATALOG = 'src/design/catalog.json';
const OUT_OF_SCOPE = /(^|\/)(login\.css|PublicTrip|JoinTrip|SiteChrome|Landing|Privacy|Terms)/;

/** A catalog body. Declared here rather than next to the tests that spell one
 *  out, because `autoCatalog` needs it too — and a `const` read from above its
 *  own line only works at all because test callbacks run after the module has
 *  finished evaluating. */
const cat = (families) => JSON.stringify({ families }, null, 2);

function autoCatalog(files) {
  if (CATALOG in files) return files;
  const fams = new Set();
  for (const [p, body] of Object.entries(files)) {
    if (!p.endsWith('.css') || typeof body !== 'string' || OUT_OF_SCOPE.test(p)) continue;
    for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
      fams.add(m[1].replace(/(__|--).*/, '').split('-')[0]);
    }
  }
  return { ...files, [CATALOG]: cat(Object.fromEntries([...fams].sort().map((f) => [f, 'triage']))) };
}

/**
 * A repo with two commits. Every fixture gets a `src/` in the BASE commit —
 * without it the base worktree has nothing to audit, which is a different
 * failure from the one under test.
 */
function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2o-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  put(dir, 'src/.keep', '');
  for (const [p, body] of Object.entries(autoCatalog(base))) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  // The head side sees the base files too, so its catalog is derived over both.
  // When either side states one, `autoCatalog` keeps it and this rewrites the
  // same body — which is why there is no "does head have one already" branch.
  const merged = autoCatalog({ ...base, ...head });
  for (const [p, body] of Object.entries({ ...head, [CATALOG]: merged[CATALOG] })) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);

  return { dir, baseRef };
}

function run({ dir, baseRef }, { args = [], ref, cwd } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: cwd ? join(dir, cwd) : dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** `n` classes inside ONE family — grows `classes`, leaves `namespaces` alone. */
const family = (n) =>
  Array.from({ length: n }, (_, i) => `.a-c${i} { color: red; }`).join('\n') + '\n';

/* ────────────── the failure mode this guard exists to prevent ───────────── */

test('★ classes DOWN while namespaces UP is a violation, not a trade', (t) => {
  // The previous attempt, exactly: the number that was watched improved, the
  // number that was not watched grew by 8, and the report quoted the first one.
  const f = fixture(t, {
    base: { 'src/a.css': '.a-1{color:red} .a-2{color:red} .a-3{color:red} .a-4{color:red} .a-5{color:red}' },
    head: { 'src/a.css': '.a-1{color:red} .a-2{color:red} .b-3{color:red} .b-4{color:red}' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /пространств имён: 1 → 2/);
  assert.doesNotMatch(r.out, /классов: /, 'classes went down — it must not be reported as a violation');
});

/* ───────────────────────────── the ratchet ──────────────────────────────── */

test('identical trees → green, and it says so', (t) => {
  const f = fixture(t, { base: { 'src/a.css': family(3) } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /пол держится/);
});

test('every number going down → green', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(6), 'src/A.jsx': 'const a = <i style={{top: 1}}/>;\n', 'src/t.css': ':root{--x:1;--y:2}' },
    head: { 'src/a.css': family(2), 'src/A.jsx': 'const a = <i/>;\n', 'src/t.css': ':root{--x:1}' },
  });
  assert.equal(run(f).code, 0);
});

test('+1 class → red', (t) => {
  const f = fixture(t, { base: { 'src/a.css': family(2) }, head: { 'src/a.css': family(3) } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /классов: 2 → 3/);
});

test('+1 inline style → red', (t) => {
  const f = fixture(t, {
    base: { 'src/A.jsx': 'const a = <i style={{top: 1}}/>;\n' },
    head: { 'src/A.jsx': 'const a = <i style={{top: 1}}/>; const b = <i style={{left: 2}}/>;\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /инлайнов/);
});

/* ── the token predicate: 163 is reachable two ways, one of them broken ──── */

test('+1 token in the :root of a NEW file → red', (t) => {
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --ink: #111; }' },
    head: { 'src/app.css': ':root { --ink: #111; }', 'src/index.css': ':root { --font-sans: Golos; }' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /токенов в :root: 1 → 2/);
});

test('a token added only inside a COMMENT → green (--sp-9, app.css:141)', (t) => {
  // Without stripping comments this is a false red — and a false positive is
  // more expensive than a miss, because it teaches people to route around the
  // guard. The stripping lives in audit-design.mjs; this pins that it is used.
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --sp-8: 20px; }' },
    head: { 'src/app.css': ':root { --sp-8: 20px; /* --sp-9: 24px выпилен, шкала кончается на 8 */ }' },
  });
  assert.equal(run(f).code, 0);
});

test('a dark-theme re-pointing of an existing name → green', (t) => {
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --ink: #111; }' },
    head: { 'src/app.css': ':root { --ink: #111; } :root[data-theme="dark"] { --ink: #eee; }' },
  });
  assert.equal(run(f).code, 0);
});

test('a variable on a component variant → green (law 3, and phases 04–06 add these)', (t) => {
  // `.btn--primary { --fg: … }` is a variable read by its own subtree. Counting
  // it would turn the floor into a brake on the correct direction.
  const f = fixture(t, {
    base: { 'src/app.css': ':root{--ink:#111} .btn{--fg:var(--ink);color:var(--fg)} .btn--x{--fg:#fff}' },
    head: { 'src/app.css': ':root{--ink:#111} .btn{--fg:var(--ink);color:var(--fg)} .btn--x{--fg:#fff;--bd:#eee}' },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /вне :root \(репорт, не блокирует\)/, 'the hole must still be visible');
});

/* ── demotion: the count goes DOWN and it is still a violation ───────────── */

test('★ a token moved from :root onto a class is a violation, though the count FELL', (t) => {
  // Found on the live repo by moving `--accent` out of `:root`: the line read
  // `163 → 162  -1`, a minus, i.e. progress — while the vocabulary was
  // unchanged and the name had merely hidden. Same failure as "classes down,
  // namespaces up", transposed onto the token axis; a count-only ratchet cannot
  // see it by construction.
  // `.card` exists on BOTH sides on purpose: the class count must not move, so
  // the ONLY thing that can make this red is the demotion itself.
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --ink: #111; --accent: #f00; } .card { color: red; }' },
    head: { 'src/app.css': ':root { --ink: #111; } .card { color: red; --accent: #f00; }' },
  });
  const r = run(f);
  assert.equal(r.code, 1, `a demotion must be red even though the count fell:\n${r.out}`);
  assert.doesNotMatch(r.out, /✗ классов/, 'and red for the demotion, not for anything else');
  assert.match(r.out, /--accent: был в :root/);
  assert.match(r.out, /токенов в :root.*2\s*→\s*1/, 'and the falling count is still shown honestly');
});

test('DELETING a token outright is not a demotion — that is the direction we want', (t) => {
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --ink: #111; --accent: #f00; } .card { color: red; }' },
    head: { 'src/app.css': ':root { --ink: #111; } .card { color: red; }' },
  });
  assert.equal(run(f).code, 0);
});

test('moving a token between two :root files is not a demotion', (t) => {
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --ink: #111; --accent: #f00; }' },
    head: { 'src/app.css': ':root { --ink: #111; }', 'src/index.css': ':root { --accent: #f00; }' },
  });
  assert.equal(run(f).code, 0);
});

test('a name also defined in the dark :root cannot be demoted by touching the light one', (t) => {
  // The set is keyed by NAME, so the dark block holds the name up. This is why
  // only the "light-only" names are demotable at all — worth pinning, because
  // the first attempt to reproduce the bug picked `--sh-1` and saw nothing.
  const f = fixture(t, {
    base: { 'src/app.css': ':root { --sh-1: a; } :root[data-theme="dark"] { --sh-1: b; } .card { color: red; }' },
    head: { 'src/app.css': ':root[data-theme="dark"] { --sh-1: b; } .card { color: red; --sh-1: a; }' },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /токенов в :root.*1\s*→\s*1/);
});

/* ────────── 7-е число: apart (обличья вне осей) — TRIP-364 PR-I ────────── */

/** Каталог с `apart`. До TRIP-364 PR-I это поле не храповилось НИЧЕМ: оно живёт
 *  внутри 2q, а 2o про него не знал. Значит любое уникальное исполнение можно
 *  было положить в apart с красивой причиной, и ни одно число не краснело -
 *  дверь ровно того класса, который эпик и закрывает. Показательно, что первый
 *  же кандидат в apart (`sev--dashed`) оказался наполовину кандидатом на снос. */
const catAp = (families, apart) => JSON.stringify({ families, apart }, null, 2);

test('★★ 7 · apart ВЫРОС — красный: список исключений обязан пустеть', (t) => {
  // CSS на обеих сторонах ОДИНАКОВ намеренно: растёт ровно одно число. Первая
  // редакция дописывала класс и поднимала заодно `classes`, из-за чего тест про
  // apart падал по чужой причине - фикстура обязана двигать то, что называет.
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина' } }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина', y: 'ещё одна' } }) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /обличий вне осей \(apart\): 1 → 2/);
});

test('★ 7 · apart УПАЛ — зелёный (храповик крутится вниз)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина', y: 'ещё одна' } }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина' } }) },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /обличий вне осей \(apart\)\s+2 →\s+1\s+-1/);
});

test('★ 7 · рост apart проходит по floor-exempt с причиной', (t) => {
  // Маркер читается из ДОБАВЛЕННЫХ строк диффа, поэтому живёт в CSS-комментарии,
  // а само число растёт в каталоге: JSON комментариев не носит.
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина' } }) },
    head: {
      'src/a.css': `/* floor-exempt: apart +1 — разбор обличья отложен, апрув Pavel */\n${family(2)}`,
      'src/design/catalog.json': catAp({ a: 'canon' }, { a: { x: 'причина', y: 'ещё одна' } }),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

/* ───────────────────────────── the escape ───────────────────────────────── */

test('an exemption on an ADDED line grants exactly its budget', (t) => {
  // `.a-*` is a `triage` family here, so the new class raises TWO numbers —
  // see the test below, which is where that is the subject rather than setup.
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: {
      'src/a.css':
        `/* floor-exempt: classes +1 — примитив раскладки, апрув Pavel */\n` +
        `/* floor-exempt: triage +1 — он же, семейство ещё на разборе */\n${family(3)}`,
    },
  });
  assert.equal(run(f).code, 0);
});

test('★ новый класс в семействе НА РАЗБОРЕ требует двух разрешений, в КАНОНЕ - одного', (t) => {
  // Не бюрократия, а сообщение: два маркера означают «дописал в кучу», один -
  // «дописал в систему». Разницу видно в диффе до того, как её объяснят словами.
  const inTriage = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: {
      'src/a.css': `/* floor-exempt: classes +1 — апрув Pavel */\n${family(3)}`,
      'src/design/catalog.json': cat({ a: 'triage' }),
    },
  });
  const r1 = run(inTriage);
  assert.equal(r1.code, 1, r1.out);
  assert.match(r1.out, /классов на разборе: 2 → 3/);

  const inCanon = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'canon' }) },
    head: {
      'src/a.css': `/* floor-exempt: classes +1 — апрув Pavel */\n${family(3)}`,
      'src/design/catalog.json': cat({ a: 'canon' }),
    },
  });
  assert.equal(run(inCanon).code, 0, 'в каноне пятое число не растёт - одного разрешения хватает');
});

test('an exemption smaller than the growth does not cover it', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: { 'src/a.css': `/* floor-exempt: classes +1 — апрув Pavel */\n${family(4)}` },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /разрешено \+1/);
});

test('an exemption for a DIFFERENT metric does not cover this one', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: { 'src/a.css': `/* floor-exempt: tokens +5 — апрув Pavel */\n${family(3)}` },
  });
  assert.equal(run(f).code, 1);
});

test('an exemption already on the base branch does NOT grant again', (t) => {
  // This is why the marker is read from the diff and not from the file: a
  // merged allowance would otherwise become a permanent, invisible budget.
  const marker = '/* floor-exempt: classes +1 — апрув Pavel */\n';
  const f = fixture(t, {
    base: { 'src/a.css': marker + family(2) },
    head: { 'src/a.css': marker + family(3) },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'a marker inherited from the base is not an addition');
});

test('an exemption naming an unknown metric is an ERROR, not a silent no-op', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: { 'src/a.css': `/* floor-exempt: klasses +9 — опечатка */\n${family(3)}` },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /unknown metric/);
});

/* ────────────────────────────── plumbing ────────────────────────────────── */

test('an unresolvable BASE_REF is RED, not skipped', (t) => {
  // The opposite of 2l/2m on purpose: they judge a per-file diff, so with no
  // base there is nothing to judge. Here, with no base the floor is not being
  // held — and "OK" would claim that it is.
  const f = fixture(t, { base: { 'src/a.css': family(2) }, head: { 'src/a.css': family(9) } });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /пол держится/, '"could not measure" must not read as "measured, clean"');
});

test('run from a subdirectory still measures the whole tree', (t) => {
  // 2l printed `0 changed file(s) — OK` on any amount of dirt when started
  // anywhere but the repo root. "Nothing to check" must never look like "clean".
  const f = fixture(t, { base: { 'src/a.css': family(2) }, head: { 'src/a.css': family(5) } });
  assert.equal(run(f, { cwd: 'src' }).code, 1, 'a subdirectory run must not go green');
});

test('a marker OUTSIDE src/ grants nothing (the guard failed its own PR on this)', (t) => {
  // Found by the code-simplifier pass on this very PR: with no pathspec, the
  // whole repo is scanned and the fixture STRINGS in this test file read as
  // real exemptions — so guard 2o exited 2 on the commit that introduced it.
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: {
      'src/a.css': family(3),
      // Both halves of the hole: a valid grant that must not apply, and a typo
      // that must not blow the run up, neither of them under src/.
      'scripts/x.test.mjs': "const fixture = '/* floor-exempt: classes +9 */';\n",
      'memory/note.md': 'floor-exempt: klasses +9 — прошлая заметка\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `a marker outside src/ must neither grant budget nor error:\n${r.out}`);
  assert.match(r.out, /классов: 2 → 3/);
});

test('the base worktree is removed even when the guard FAILS (exit 1)', (t) => {
  const f = fixture(t, { base: { 'src/a.css': family(2) }, head: { 'src/a.css': family(5) } });
  assert.equal(run(f).code, 1);
  const worktrees = git(f.dir, ['worktree', 'list']).trim().split('\n');
  assert.equal(worktrees.length, 1, `a leaked worktree poisons every later run:\n${worktrees.join('\n')}`);
});

test('the base worktree is removed even when the guard CANNOT MEASURE (exit 2)', (t) => {
  // The exit-1 path runs after the try block, so it stayed clean even while
  // cleanup sat in a `finally` — and `die()` calls process.exit, which does not
  // unwind the stack. The die paths were the ones that leaked, and only this
  // test tells them apart.
  const f = fixture(t, {
    base: { 'src/a.css': family(2) },
    head: { 'src/Broken.jsx': 'export const C = () => <div className={;;;}/>;\n' },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /could not parse/);
  const worktrees = git(f.dir, ['worktree', 'list']).trim().split('\n');
  assert.equal(worktrees.length, 1, `leaked on the die path:\n${worktrees.join('\n')}`);
});

test('there is no --write and no baseline to refresh', (t) => {
  const f = fixture(t, { base: { 'src/a.css': family(2) }, head: { 'src/a.css': family(5) } });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2, '--write must not be a way to bless a regression');
  assert.match(r.out, /unknown flag/);
});

test('the metric table and the audit cannot drift apart silently', (t) => {
  // Every metric in the table must be a number the audit actually reports; a
  // renamed field has to fail loudly rather than compare `undefined`.
  const f = fixture(t, { base: { 'src/a.css': family(2) } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  for (const label of ['классов', 'пространств имён', 'инлайнов', 'токенов в :root']) {
    assert.match(r.out, new RegExp(`${label}.*\\d+\\s*→\\s*\\d+`), `${label} must be printed with both numbers`);
  }
});

/* ───────────── the fifth number: classes under review (TRIP-340) ─────────── */
/**
 * Разделение труда прежнее: ЧТО считается каноном и разбором пинится в
 * audit-design.test.mjs на фикстурах AUDIT_ROOT. Здесь - обвязка: что пол
 * пятое число действительно храповит, что отсутствие каталога на базе и на
 * HEAD - РАЗНЫЕ вердикты, и что три способа каталогу разойтись с деревом
 * краснеют, а не тихо занижают число.
 */

test('★ каталога нет на БАЗЕ - пол по нему устанавливается этим PR, не падает', (t) => {
  // Ровно этот PR: на dev файла ещё нет. Вердикт обязан отличаться от «=».
  const f = fixture(t, {
    base: { 'src/a.css': family(3), 'src/design/catalog.json': null },
    head: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'triage' }) },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /классов на разборе\s+—\s+→\s+3\s+пол установлен этим PR/);
});

test('★ каталога нет на HEAD - красный: удаление файла не способ пройти метрику', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(3), 'src/design/catalog.json': null },
  });
  const r = run(f);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /каталога нет/);
});

test('классов на разборе стало больше → нарушение', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(4), 'src/design/catalog.json': cat({ a: 'triage' }) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /классов на разборе: 2 → 4/);
});

test('классов на разборе стало меньше → зелёный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(4), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
  });
  assert.equal(run(f).code, 0);
});

test('★ повышение triage → canon печатается: число упало без работы над кодом', (t) => {
  // Единственный ход, которым пятое число улучшается бесплатно. Он законный,
  // поэтому не блокируется - но обязан быть перед глазами ревьюера.
  const f = fixture(t, {
    base: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'canon' }) },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /a: triage → canon/);
  assert.match(r.out, /БЕЗ работы над кодом/);
});

test('понижение canon → triage поднимает число и ловится храповиком', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'canon' }) },
    head: { 'src/a.css': family(3), 'src/design/catalog.json': cat({ a: 'triage' }) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a: canon → triage/);
  assert.match(r.out, /классов на разборе: 0 → 3/);
});

test('новое семейство без строки в каталоге → красный, а не тихий ноль', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: {
      'src/a.css': family(2),
      'src/b.css': '.b-1{color:red}',
      'src/design/catalog.json': cat({ a: 'triage' }),
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /не размечено в каталоге \(1\): b/);
});

test('строка каталога про исчезнувшее семейство → красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage', b: 'triage' }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage', b: 'triage' }) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /которого больше нет \(1\): b/);
});

test('★ опечатка в статусе → красный, хотя число при этом ПАДАЕТ', (t) => {
  // Без этой проверки «canonn» проходит как улучшение: 2 → 0.
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'canonn' }) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /неверный статус/);
});

test('сломанный каталог - «не смог измерить» (2), а не «каталога нет»', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': family(2), 'src/design/catalog.json': cat({ a: 'triage' }) },
    head: { 'src/a.css': family(2), 'src/design/catalog.json': '{ "families": {' },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /не читается/);
});

/* ────────── шестая метрика: экран дотянулся в примитив (TRIP-364) ────────── */

test('★ шестая метрика ловит НОВОЕ потомковое правило на примитиве', (t) => {
  const f = fixture(t, {
    base: {
      'src/a.css': '.btn { color: red; }',
      [CATALOG]: '{"families":{"btn":"canon","scr":"triage"}}',
    },
    head: {
      'src/a.css': '.btn { color: red; }\n.scr-x .btn { flex: 1; }',
      [CATALOG]: '{"families":{"btn":"canon","scr":"triage"}}',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /экран дотянулся в примитив: 0 → 1/);
});

test('★★ ПЕРЕКЛЕЙКА triage → canon шестую метрику НЕ двигает', (t) => {
  // Число зависит от каталога по построению: расширение языка меняет его без
  // единой строки CSS, причём в ОБЕ стороны (на живом репо `bgt` triage→canon
  // дал 53 → 47, то есть молча забанковал бы прогресс). Переклейка объявлена
  // легальной, бесплатной и никогда не блокируемой, поэтому храповик по «своему»
  // каталогу краснел бы на правильном ходе - а такой гард выключают. Лечение:
  // HEAD меряется канон-набором БАЗЫ.
  const css = '.btn { color: red; }\n.scr-x .btn { flex: 1; }\n.scr-x .card { gap: 2px; }';
  const f = fixture(t, {
    base: { 'src/a.css': css, [CATALOG]: '{"families":{"btn":"canon","card":"triage","scr":"triage"}}' },
    head: { 'src/a.css': css, [CATALOG]: '{"families":{"btn":"canon","card":"canon","scr":"triage"}}' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /экран дотянулся в примитив\s+1 →\s+1/);
});
