#!/usr/bin/env node
/**
 * CI guard 2o (TRIP-337 Ф0) — the design floor: no headline number may grow.
 *
 * WHY THIS IS THE FIRST THING BUILT. The previous attempt failed in a specific,
 * repeatable way: classes went down, namespaces went UP by 8, and the report
 * quoted the first number. Nobody lied — the metric that was watched improved.
 * A floor that ratchets EVERY number AT ONCE makes that failure mechanically
 * impossible, which is why it has to exist before a single class is touched.
 *
 * `audit-design.mjs` has been able to count all of this for a while. It just
 * printed a report, and a report is a thing you can decline to read.
 *
 * ── HOW THE CEILING IS ESTABLISHED ──
 * The SAME `audit-design.mjs` — the one sitting next to this file, resolved
 * from `import.meta.url`, never the base branch's copy — is run twice: once
 * against a detached worktree of BASE_REF, once against the working tree. One
 * instrument, both sides: change the instrument and BOTH numbers move together,
 * so simply lowering the counts buys nothing.
 *
 * That is ALMOST a closed door, and the gap is worth naming rather than
 * overclaiming: an edit that under-counts by a feature which exists only on
 * HEAD (say, "ignore classes in files added this PR") moves one side and not
 * the other, and would go green on real growth. What holds that shut is not
 * this guard — it is that the edit must appear in `audit-design.mjs`, in the
 * diff, under 43 tests. Cheap to see, hard to do by accident.
 *
 * Running this checkout's script also sidesteps the fact that the base worktree has no
 * `node_modules`: the script that executes is always this checkout's, so its
 * `acorn` import resolves from this checkout.
 *
 * NO COMMITTED BASELINE. A ceiling the PR can edit is not a ceiling — 2l
 * shipped green with three bypasses built on exactly that, and said so in its
 * own header: "a count alone is bypassable".
 *
 * ── THE METRIC SET IS A TABLE, NOT FOUR BRANCHES ──
 * Subtask 03 adds a fifth number (classes "under review"), so the word "four"
 * appears nowhere in the logic. Adding a metric is one row — and one row in
 * `audit-design.mjs --json`.
 *
 * ── THE TOKEN PREDICATE (Р8), AND THE HOLE IT LEAVES OPEN ON PURPOSE ──
 * A token is a name declared in `:root` — visible from everywhere. Not counted:
 * the 88 `:root[data-theme=dark]` re-pointings (zero new names), and a variable
 * on a variant (`.btn--primary{--x:…}`, `.tile--xl`, `.pt-itin{--num,--gap}`;
 * 40 such rules in app.css alone) — that is law 3 done right, and phases 04–06
 * produce them by the handful, so counting them would make the floor a brake on
 * the correct move.
 *
 * ⚠ THE KNOWN HOLE, STATED SO IT IS NOT SILENT: a private dictionary inside a
 * token island escapes the predicate — login.css `.auth` holds 4 names of its
 * own (`--font-body` is a private twin of `--font-sans`, both TRIP-165) and
 * PublicTrip.css `.pt-itin` 2. It is not this subtask's to close: login.css is
 * outside the perimeter until subtask 10, at which point those names either
 * collapse or move into `:root` and fall under this floor by themselves. Until
 * then the guard PRINTS them on every run without blocking.
 *
 * ── WHERE IT DIFFERS FROM 2l / 2m, DELIBERATELY ──
 * An unresolvable BASE_REF makes those guards SKIP, and that is right for them:
 * they judge a per-file diff, so with no base there is genuinely nothing to
 * judge. Here it is the opposite — with no base the floor is not holding, and
 * printing "OK" would say that it is. So: RED. Same for a tree the audit cannot
 * parse (`parseFailures`): unparsed JSX under-counts classes, which is a false
 * red on the base side and a false GREEN on the head side. "Nothing to check"
 * and "checked, clean" must never print the same verdict.
 *
 * ── ESCAPE ──
 * Same idiom as 2m's `prefix-exempt` — a marker carrying its reason, visible in
 * the diff at review time, because that visibility IS the approval flow:
 *
 *     floor-exempt: classes +3 — примитивы раскладки Ф3, апрув Pavel
 *
 * Read from the ADDED LINES of the diff, not from the file contents. That makes
 * the allowance last exactly one PR: once merged the line is no longer an
 * addition, so it cannot silently grant the same budget again. A marker naming
 * a metric that does not exist is an ERROR, not a no-op — a typo must not read
 * as "no exemption requested".
 *
 * NOTE the asymmetry, which only shows up locally: the NUMBERS come from the
 * working tree (so you can iterate without committing), the ALLOWANCES from the
 * committed diff (so an inherited marker cannot grant twice). In CI the two are
 * the same tree. Locally an uncommitted marker is not yet seen — the run goes
 * red until you commit it, which is the safe direction to be wrong in.
 *
 * Zero judgement calls live here: the counting is someone else's script, this
 * runs it twice and subtracts.
 *
 * Env: BASE_REF (default origin/dev). Exit: 0 ok, 1 violation, 2 cannot measure.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'floor-exempt';
const AUDIT = fileURLToPath(new URL('./audit-design.mjs', import.meta.url));

/** key → the `audit-design.mjs --json` field it reads. The key is what an
 *  exemption marker names, so it is part of the contract and does not get
 *  renamed casually. Numbers on dev @ 6a659c8 (TRIP-337 §2) in the comments. */
const METRICS = [
  { key: 'classes', field: 'classes', label: 'классов' }, //                    1341
  { key: 'namespaces', field: 'namespaces', label: 'пространств имён' }, //      124
  { key: 'inline', field: 'inlineAll', label: 'инлайнов style={{…}}' }, //       694
  { key: 'tokens', field: 'rootTokens', label: 'токенов в :root' }, //           163
];

const die = (msg, extra = []) => {
  console.error(`::error::check-design-floor: ${msg}`);
  extra.forEach((l) => console.error(`  ${l}`));
  process.exit(2);
};

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  die(`unknown flag ${unknown.join(' ')}.`, [
    'There is no baseline to refresh and no --write: the ceiling is the base branch.',
  ]);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------- measuring -------------------------------- */

/** Run the audit over `<cwd>/src`. AUDIT_ROOT stays the RELATIVE 'src' and the
 *  cwd moves instead, so both sides see identical relative paths — the audit's
 *  OUT_OF_SCOPE test matches on the path, and an absolute temp path could
 *  otherwise classify files differently on the two sides. */
function measure(cwd, side) {
  const r = spawnSync(process.execPath, [AUDIT, '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AUDIT_ROOT: 'src' },
  });
  if (r.error) die(`cannot run audit-design.mjs on ${side}: ${r.error.message}`);
  if (r.status !== 0) die(`audit-design.mjs failed on ${side} (exit ${r.status})`, (r.stderr || '').split('\n'));

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    die(`audit-design.mjs printed unparseable JSON on ${side}: ${e.message}`);
  }

  // An unparsed file looks exactly like a file with no classes in it.
  if (json.parseFailures?.length) {
    die(`${side}: audit-design.mjs could not parse ${json.parseFailures.length} file(s), so the counts are understated`,
      json.parseFailures);
  }
  for (const m of METRICS) {
    if (typeof json[m.field] !== 'number') {
      die(`${side}: audit-design.mjs does not report \`${m.field}\` — the metric table and the audit have drifted apart`);
    }
  }
  return json;
}

/* -------------------------------- exemptions ------------------------------ */

/** `floor-exempt: <key> +N — reason`, read from the lines this PR ADDS **under
 *  `src/`** — the same tree every metric is measured over, so the allowance sits
 *  next to the code it excuses, which is what makes it reviewable.
 *
 *  ★ THE PATHSPEC IS LOAD-BEARING, AND THIS GUARD PROVED IT ON ITSELF. Without
 *  it the whole repo is scanned, so ANY line mentioning the marker counts — and
 *  the very first thing that trips over that is this guard's own test file,
 *  which builds fixtures out of strings like `floor-exempt: klasses +9`. Guard
 *  2o therefore failed with exit 2 on the PR that introduced it. Milder half of
 *  the same hole: a marker in `memory/`, a doc or a script would have granted
 *  real budget over a tree it does not describe. 2l and 2m are immune for
 *  exactly this reason — they read markers only out of the files they scan. */
function allowances() {
  let diff;
  try {
    diff = git(['diff', '--unified=0', `${BASE_REF}...HEAD`, '--', 'src/']);
  } catch (e) {
    die(`cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
  }
  const known = new Set(METRICS.map((m) => m.key));
  const out = Object.create(null);
  const re = new RegExp(`${EXEMPT}:\\s*([a-zA-Z][\\w-]*)\\s*\\+(\\d+)`, 'g');
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const m of line.matchAll(re)) {
      if (!known.has(m[1])) {
        die(`exemption names an unknown metric \`${m[1]}\` — a typo must not read as "no exemption".`, [
          `known metrics: ${[...known].join(', ')}`,
          `the marker was: ${line.slice(1).trim()}`,
        ]);
      }
      out[m[1]] = (out[m[1]] ?? 0) + Number(m[2]);
    }
  }
  return out;
}

/* --------------------------------- verdict -------------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  // NOT a skip — see the header. With no base there is no floor.
  die(`BASE_REF ${BASE_REF} is not resolvable, so the floor cannot be measured.`, [
    'This guard needs the full base branch: `git fetch --no-tags origin <base>` and',
    'actions/checkout with `fetch-depth: 0`. It deliberately does NOT skip: a floor',
    'that reports OK when it did not measure anything is worse than no floor.',
  ]);
}

// Everything below resolves from cwd — the worktree path, `src`, the diff
// pathspec. Run from a subdirectory without this and the guard measures nothing
// and calls it clean, which is precisely how 2l printed `0 changed file(s) — OK`
// on any amount of dirt.
const root = git(['rev-parse', '--show-toplevel']).trim();
process.chdir(root);

const exempt = allowances();

// `git worktree add` requires a path that does not exist yet, hence the child.
const holder = mkdtempSync(join(tmpdir(), 'design-floor-'));
const basePath = join(holder, 'base');

/** ★ CLEANUP HANGS OFF `exit`, NOT OFF `finally`. `die()` calls `process.exit`,
 *  and that does NOT unwind the stack — a `finally` is skipped on exactly the
 *  failure paths that leak (unparseable JSON, `parseFailures`, a missing metric
 *  field, the audit crashing on either side). The first version used `finally`
 *  and its test only covered the exit-1 path, which runs AFTER the block — so
 *  the test passed while the invariant it was named for was false. A leaked
 *  worktree poisons every later run in the same clone, and this repo is checked
 *  out once with a dozen long-lived sibling worktrees. */
process.on('exit', () => {
  try {
    git(['worktree', 'remove', '--force', basePath]);
  } catch {
    /* the add may never have happened */
  }
  rmSync(holder, { recursive: true, force: true });
});

try {
  git(['worktree', 'add', '--detach', basePath, BASE_REF]);
} catch (e) {
  die(`cannot check out ${BASE_REF} into a worktree: ${e.stderr || e.message}`);
}
const base = measure(basePath, `${BASE_REF} (base)`);
const head = measure(root, 'HEAD');

const rows = METRICS.map((m) => {
  const was = base[m.field];
  const now = head[m.field];
  const allowed = exempt[m.key] ?? 0;
  return { ...m, was, now, allowed, over: now - was - allowed };
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`check-design-floor (2o): HEAD vs ${BASE_REF}`);
for (const r of rows) {
  const delta = r.now - r.was;
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
  const note = r.allowed ? `  (floor-exempt +${r.allowed})` : '';
  console.log(`  ${r.label.padEnd(width)}  ${String(r.was).padStart(5)} → ${String(r.now).padStart(5)}  ${sign}${note}`);
}

// Non-blocking: names declared outside `:root` that `:root` does not have. Not
// vocabulary (a variant's own variable is law 3 done right), not this subtask's
// problem (login.css is outside the perimeter until subtask 10) — but printed,
// so the hole is not silent.
const priv = head.privateTokens ?? [];
if (priv.length) {
  const byFile = new Map();
  for (const t of priv) {
    for (const f of t.files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(t.name);
    }
  }
  const wasPriv = new Set((base.privateTokens ?? []).map((t) => t.name));
  const fresh = priv.filter((t) => !wasPriv.has(t.name)).map((t) => t.name);
  console.log(`  ─ вне :root (репорт, не блокирует): ${priv.length}${fresh.length ? `, новых: ${fresh.join(' · ')}` : ''}`);
  for (const [f, names] of [...byFile].sort()) console.log(`      ${f}: ${[...new Set(names)].sort().join(' · ')}`);
}

/** ★ A DEMOTION IS A VIOLATION EVEN THOUGH THE COUNT WENT DOWN.
 *  Move `--accent` from `:root` onto `.card` and the token line reads
 *  `163 → 162  -1` — a minus, i.e. progress. The vocabulary did not shrink by
 *  one; the NAME HID. This is precisely the failure the floor exists to stop
 *  ("lower the one being watched, grow the one that is not"), transposed onto
 *  the token axis, and a count-only ratchet cannot see it by construction.
 *
 *  The predicate is exact and cannot false-positive: the name was in `:root` on
 *  the base, is NOT in `:root` on HEAD, and STILL EXISTS in src/ under a class
 *  scope. Deleting a token outright is not a demotion (it stops existing —
 *  green, and it is the direction the epic wants). Moving it between two
 *  `:root` files is not one either. A name also defined in the dark `:root`
 *  cannot be demoted by touching only the light one — the set is keyed by name,
 *  so 88 of the 163 hold each other up; only "light-only" names can demote.
 *
 *  NO ESCAPE MARKER, DELIBERATELY. Under the 04–10 plan this is never a legal
 *  move: the direction is the opposite one, islands collapse INTO `:root` or
 *  disappear. And §5 of the epic says the composition of L0 does not change —
 *  so a real case for demoting a token is an argument about the epic, not
 *  something a line comment should be able to wave through. */
const headPrivate = new Set((head.privateTokens ?? []).map((t) => t.name));
const demoted = (base.rootTokenNames ?? []).filter((n) => headPrivate.has(n));
if (demoted.length) {
  console.error('::error::check-design-floor: токен ушёл из :root на класс — словарь не сократился, имя спряталось');
  for (const n of demoted) {
    const files = (head.privateTokens.find((t) => t.name === n)?.files ?? []).join(' · ');
    console.error(`  ✗ ${n}: был в :root на ${BASE_REF}, теперь только на классе (${files})`);
  }
  console.error('');
  console.error('  Число токенов при этом ПАДАЕТ, то есть выглядит как прогресс — это тот самый');
  console.error('  провал «снизили одно, вырастили другое» (TRIP-337 §4), только на токенной оси.');
  console.error('  По плану 04-10 такой ход не бывает легальным: направление обратное, островки');
  console.error('  схлопываются В :root или исчезают, а §5 говорит, что состав L0 не меняется.');
  console.error('  Поэтому escape-маркера здесь намеренно нет — случай обсуждается в эпике.');
  console.error('  Если токен больше не нужен - удали его, а не переноси на класс: это зелёный путь.');
  process.exit(1);
}

const broken = rows.filter((r) => r.over > 0);
if (broken.length) {
  console.error('::error::check-design-floor: пол пробит — см. TRIP-337 §4 и правило #6 в CLAUDE.md');
  for (const r of broken) {
    console.error(
      `  ✗ ${r.label}: ${r.was} → ${r.now} (+${r.now - r.was}${r.allowed ? `, разрешено +${r.allowed}` : ''})`,
    );
  }
  console.error('');
  console.error('  Пол храповит ВСЕ числа сразу именно затем, чтобы «классы снизили, пространства');
  console.error('  имён вырастили» перестало быть возможным (TRIP-337 §4). Снизить одно за счёт');
  console.error('  другого нельзя — это не размен, это тот самый провал прошлого захода.');
  console.error('');
  console.error('  Если рост согласован — пометь строку в этом же PR, причина и апрув в тексте:');
  console.error(`      /* ${EXEMPT}: ${broken[0].key} +${broken[0].now - broken[0].was - broken[0].allowed} — причина + апрув Pavel */`);
  process.exit(1);
}

console.log('  пол держится.');
process.exit(0);
