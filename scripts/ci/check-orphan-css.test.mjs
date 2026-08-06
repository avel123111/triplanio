#!/usr/bin/env node
/**
 * Tests for CI guard 2n (scripts/ci/check-orphan-css.mjs).
 *
 * WHY this file exists (TRIP-321 Ф14.11). The guard it tests was written after
 * an audit found four regressions of exactly one shape in a single PR: markup
 * moved onto a shared class, and the old private rules stayed behind pointing at
 * a name nobody emits any more. Whatever those rules held (a dot's size, an
 * icon's size, a button's line wrapping) silently went with them. Lint,
 * typecheck, build and all four existing guards were green, and the diff does
 * not show it — the diff has the added line, not the thing left off-screen.
 *
 * It also exists because my own throwaway version of this scan LIED. Written
 * once, it found none of the four: this repo's CSS comments contain braces, and
 * a rule regex that does not blank comments first desynchronises over the whole
 * file. That is why the comment case below is a test and not a code comment.
 *
 * Each test builds a throwaway git repo, commits a "base", commits a "head" and
 * runs the guard as a subprocess with BASE_REF at the base commit — end to end,
 * the way CI runs it. Template: check-inline-styles.test.mjs (TRIP-282).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-orphan-css.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Two commits: `base` is the PR base, `head` is applied on top. A value of
 *  `null` in `head` deletes the file, so "the whole component went away" is
 *  expressible. */
function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2n-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, 'index.html', '<div id="root"></div>');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [p, body] of Object.entries(head)) {
    if (body === null) rmSync(join(dir, p), { force: true });
    else put(dir, p, body);
  }
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

/* -------------------------------------------------------------------------- */

test('clean PR: markup unchanged → OK', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill"><i className="d" /></span>',
      'src/app.css': '.vpill { padding: 4px; }\n.vpill .d { width: 8px; }\n',
    },
    head: { 'src/app.css': '.vpill { padding: 5px; }\n.vpill .d { width: 8px; }\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('THE defect: markup drops the class, the rule stays → fail, names it', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill"><i className="d" /></span>',
      'src/app.css': '.vpill { padding: 4px; }\n.vpill .d { width: 8px; height: 8px; }\n',
    },
    head: {
      // moved onto the shared class — and .vpill .d was left behind
      'src/A.jsx': '<span className="badge badge--sm"><i className="d" /></span>',
      'src/app.css': '.vpill { padding: 4px; }\n.vpill .d { width: 8px; height: 8px; }\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.vpill/);
  assert.match(r.out, /src\/app\.css:1/, 'must cite where the surviving rule is');
});

test('rule removed together with the usage → OK (that is the correct edit)', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n.badge { padding: 6px; }\n',
    },
    head: {
      'src/A.jsx': '<span className="badge" />',
      'src/app.css': '.badge { padding: 6px; }\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('still used from another file → OK', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/B.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n',
    },
    head: { 'src/A.jsx': '<span className="badge" />' },
  });
  assert.equal(run(f).code, 0);
});

test('dynamic name is never flagged: it was never a literal in markup', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': 'const c = `sev--${level}`; <span className={c}><b className="old" /></span>',
      'src/app.css': '.sev--warning { color: red; }\n.sev--error { color: red; }\n.old { color: blue; }\n',
    },
    // `old` disappears from markup; `sev--warning` never was there literally
    head: { 'src/A.jsx': 'const c = `sev--${level}`; <span className={c} />' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.old/);
  assert.doesNotMatch(r.out, /sev--/, 'composed class names must not be reported');
});

test('имя переехало из литерала в шаблон — это НЕ сирота', (t) => {
  // Ровно так упал первый прогон 2n в CI на собственной правке: разметка
  // `tile tile--warning` уехала в <EmptyState kind="warning">, который собирает
  // тот же класс из карты тонов. Литерала не стало, класс жив.
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<div className="tile tile--warning"><b className="gone" /></div>',
      'src/app.css': '.tile--warning { color: orange; }\n.gone { color: red; }\n',
    },
    head: {
      'src/A.jsx': 'const tone = "warning"; <div className={`tile tile--${tone}`} />',
      'src/app.css': '.tile--warning { color: orange; }\n.gone { color: red; }\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.gone/, 'настоящая сирота из того же диффа должна найтись');
  assert.doesNotMatch(r.out, /tile--warning/, 'собранное шаблоном имя сиротой не считается');
});

test('однобуквенное начало шаблона не спасает всё подряд', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n',
    },
    head: { 'src/A.jsx': 'const k = 1; <span className={`v${k}`} />' },
  });
  assert.equal(run(f).code, 1, 'начало "v" длиной 1 не должно объявлять .vpill живым');
});

test('CSS comments contain braces — the scan must survive them', (t) => {
  // This is the bug that made the first throwaway version report a clean repo:
  // `{` inside a comment desynchronises a naive rule regex for the whole file,
  // and every rule after the comment becomes invisible.
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '/* было style={{ border: none }} — см. TRIP-282 */\n.vpill { padding: 4px; }\n',
    },
    head: { 'src/A.jsx': '<span className="badge" />' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.vpill/);
});

test('rule inside @media is scanned too', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '@media (max-width: 640px) {\n  .vpill { padding: 2px; }\n}\n',
    },
    head: { 'src/A.jsx': '<span className="badge" />' },
  });
  assert.equal(run(f).code, 1);
});

test('deleting the whole component leaves its CSS orphaned → fail', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="oldwidget" />',
      'src/app.css': '.oldwidget { padding: 4px; }\n',
    },
    head: { 'src/A.jsx': null },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.oldwidget/);
});

test('escape hatch: orphan-exempt with a reason', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n',
    },
    head: {
      'src/A.jsx': '<span className="badge" />',
      'src/app.css': '/* orphan-exempt: vpill — держится сторонним виджетом */\n.vpill { padding: 4px; }\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('exemption needs the exact name: a different one does not free it', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n',
    },
    head: {
      'src/A.jsx': '<span className="badge" />',
      'src/app.css': '/* orphan-exempt: something-else — причина */\n.vpill { padding: 4px; }\n',
    },
  });
  assert.equal(run(f).code, 1);
});

test('markup also counts from index.html and public/*.html', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="brandmark" />',
      'public/landing.html': '<i class="brandmark"></i>',
      'src/app.css': '.brandmark { width: 4px; }\n',
    },
    head: { 'src/A.jsx': '<span className="badge" />' },
  });
  assert.equal(run(f).code, 0, 'the html file still uses it');
});

test('runs from a subdirectory (nothing-to-check must not look like clean)', (t) => {
  const f = fixture(t, {
    base: {
      'src/A.jsx': '<span className="vpill" />',
      'src/app.css': '.vpill { padding: 4px; }\n',
    },
    head: { 'src/A.jsx': '<span className="badge" />' },
  });
  assert.equal(run(f, { cwd: 'src' }).code, 1, 'must find the repo root itself');
});

test('unresolvable BASE_REF is skipped, not guessed', (t) => {
  const f = fixture(t, { base: { 'src/app.css': '.a { color: red; }\n' } });
  const r = run(f, { ref: 'origin/nope' });
  assert.equal(r.code, 0);
  assert.match(r.out, /skipped/);
});

test('unknown flag is an error, not a silent pass', (t) => {
  const f = fixture(t, { base: { 'src/app.css': '.a { color: red; }\n' } });
  assert.equal(run(f, { args: ['--write'] }).code, 2);
});

/* ─────────── the catalog must not become a hiding place (TRIP-340) ───────── */
/**
 * ЗАЧЕМ ЭТО ЗДЕСЬ. TRIP-340 заводит `src/design/catalog.json` с перечнем ВСЕХ 282
 * семейств классов. Упоминание имени в репо - это ровно то, чем 2n отличает
 * «имя ещё живо» от «правило осиротело», поэтому файл-перечень имён потенциально
 * глушит гард РОВНО ТАМ, где тот начинает работать.
 *
 * ★ МАСКИРУЕМЫ НЕ ВСЕ ИМЕНА, А ОДИНОЧКИ. В каталоге лежат имена СЕМЕЙСТВ, а 2n
 * спрашивает про имена КЛАССОВ: строка `"bgt": "triage"` не может спасти
 * `.bgt-row`. Совпадают они там, где семейство состоит из одного класса -
 * `.row`, `.card`, `.trunc`, `.checkbox`, - то есть ровно у словаря самой ДС,
 * который этот эпик и двигает. Первая редакция теста этого не учла, взяла
 * `.gone-row` при семействе `gone` и была ХОЛОСТОЙ: мутация «2n читает .json как
 * разметку» её не уронила. Поймано мутацией, а не ревью.
 *
 * Замер: «есть ли класс литералом на HEAD» спрашивается только по
 * `MARKUP = /\.(jsx|tsx|js|ts|html)$/`, поэтому в гарде НЕТ списка исключений -
 * вместо кода стоит этот тест. Он ловит то, что исключение не поймало бы:
 * превращение каталога в `.js` молча вернёт маскировку.
 */
const CATALOG = JSON.stringify({ families: { gone: 'triage' }, notes: {} }, null, 2);

test('★ одиночка, оставшаяся ТОЛЬКО в каталоге (.json), правило от 2n не спасает', (t) => {
  const f = fixture(t, {
    base: {
      'src/a.css': '.gone { padding: 8px; }',
      'src/A.jsx': 'const A = () => <div className="gone"/>;',
      'src/design/catalog.json': CATALOG,
    },
    head: { 'src/A.jsx': 'const A = () => <div className="row"/>;' },
  });
  const r = run(f);
  assert.equal(r.code, 1, `каталог перечисляет имена - он не должен считаться разметкой:\n${r.out}`);
  assert.match(r.out, /gone/);
});

test('★ тот же перечень в .js МАСКИРУЕТ - вот цена смены формата', (t) => {
  // Не «а вдруг», а зафиксированная граница: это ровно то поведение, из-за
  // которого каталог - JSON. Тест не одобряет маскировку, он её НАЗЫВАЕТ:
  // смена расширения ТИХО выключает 2n на всех перечисленных именах.
  const f = fixture(t, {
    base: {
      'src/a.css': '.gone { padding: 8px; }',
      'src/A.jsx': 'const A = () => <div className="gone"/>;',
    },
    head: {
      'src/A.jsx': 'const A = () => <div className="row"/>;',
      'src/design/catalog.js': 'export default { families: { gone: "triage" } };\n',
    },
  });
  assert.equal(run(f).code, 0, 'литерал в .js читается как разметка - поэтому каталог и не .js');
});
