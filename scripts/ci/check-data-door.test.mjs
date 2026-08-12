#!/usr/bin/env node
/**
 * Tests for CI guard 2r (scripts/ci/check-data-door.mjs) — TRIP-376.
 *
 * WHY THIS FILE IS THE FIRST THING WRITTEN, AND WHY IT IS THE SPEC.
 * Three independent runs over "direct writes from the browser" produced three
 * different sets of numbers (TRIP-376 thread: `.from(` counted 86 / 89 / 44;
 * `Response.json({` multi-line 21 / 4; `ok: false` 10 / 8). Nobody made an
 * arithmetic mistake — each run answered a DIFFERENT QUESTION, because the
 * quantity was never defined. Same failure as "raw spacing" on the neighbouring
 * epic (962 / 1011 / 1304, TRIP-339 §10).
 *
 * So the predicate becomes code BEFORE the number, and every decision inside it
 * is pinned by ITS OWN FIXTURE below — a file whose answer is known by
 * construction. Agreeing with someone's ballpark proves nothing: on guard 2o
 * the correct and the broken implementation printed the same 163.
 *
 * Each test builds a throwaway git repo, commits a base, commits a head, and
 * runs the guard as a subprocess with BASE_REF pointed at the base commit —
 * end to end, the way CI runs it. Template: `check-inline-styles.test.mjs`.
 *
 * ── THE MUTATIONS THIS FILE IS REQUIRED TO CATCH ──
 * A green test proves nothing until it has been seen red. Each of these is a
 * plausible way to get the counting wrong, and each has a test named after it:
 *   1. drop the whitelist                → `whitelisted write does not count`
 *   2. stop blanking comments            → `a call inside a comment does not count`
 *   3. ratchet only the first metric     → `growth in a LATER metric is caught`
 *   4. miss a table behind a variable    → `write with a variable table is counted`
 *   5. match line-by-line (grep-shaped)  → `multi-line chain is counted`
 *   6. only `{ error` counts as a refusal→ `ok:false` / `allow:false` / 2-arg form
 *   7. read markers repo-wide            → `marker outside the pathspec is ignored`
 *   8. `finally` instead of exit hook    → `no worktree leaks on a die() path`
 *   9. missing base treated as a skip    → `unresolvable BASE_REF is RED`
 *  10. a bucket read as a table          → `storage.from is not a table write`
 *  11. status >= 400 with no refusal key → `status >= 400 counts even with NO…`
 *  12. the home-screen count never taken → `home-screen calls are COUNTED…`
 *  13. three RPC buckets folded into one → `the three RPC buckets get one EACH`
 *  14. `reads` never incremented        → `a literal-table READ is counted`
 *  15. whitelist folded into doubleDoor  → `a DECLARED two-door table…`
 *  16. a regex literal read as a comment → `a regex literal containing `//`…`
 *  17. code points vs code units         → `an emoji does not shift the blanking`
 *
 * ⚠ 12–16 were added by a mutation pass over an already-green suite: each one
 * is a change to the guard that ALL 43 tests then passed. Two of them (12, 13)
 * were assertions that named the right thing and checked a label the board
 * prints unconditionally — the inert shape this file exists to avoid. The
 * lesson is the project's, not this file's: a green test proves nothing until
 * it has been seen red, and "seen red" means the mutation was actually applied
 * (TRIP-351: a mutation report was three items richer than the truth because
 * the search strings had gone stale and the replacements silently matched
 * nothing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-data-door.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Build a repo with two commits: `base` is the PR base, `head` is applied on top. */
function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2r-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  // A developer's global gpgsign / hooksPath would otherwise break the fixture
  // and get reported as a guard failure.
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [p, body] of Object.entries(head)) put(dir, p, body);
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

/* ── fixture bodies. Each one's answer is known by construction. ─────────── */

/** A source file with `n` plain literal-table writes on tables nobody whitelists. */
const writes = (n) =>
  Array.from({ length: n }, (_, i) => `await supabase.from('budget_expenses').insert({ i: ${i} });`).join('\n') + '\n';

/** An edge function that writes `table`. Two of these + a src write = a double door. */
const edgeWrite = (table) =>
  `import { withHandler } from '../_shared/http.ts';\n` +
  `Deno.serve(withHandler('f', async () => {\n` +
  `  await admin.from('${table}').insert({ a: 1 });\n` +
  `  return Response.json({ ok: true });\n` +
  `}));\n`;

/** An edge function with `n` raw `{ error }` responses, one per line. */
const rawErrors = (n) =>
  Array.from({ length: n }, (_, i) => `  if (x === ${i}) return Response.json({ error: 'no' }, { status: 400 });`).join('\n') + '\n';

/* ───────────────────────────── the floor holds ──────────────────────────── */

test('identical base and head — nothing grew, exit 0', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(3) }, head: {} });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('prints every metric, always — the board is the point', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(2) }, head: {} });
  const r = run(f);
  for (const label of ['мутирующих RPC', 'прямых записей', 'прямых чтений', 'сырых ответов', 'двумя дверями']) {
    assert.match(r.out, new RegExp(label), `метрика «${label}» не напечатана:\n${r.out}`);
  }
});

test('a new literal write is caught', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(1) }, head: { 'src/a.js': writes(2) } });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /прямых записей/);
});

/* ───────────── mutation 1: the whitelist is load-bearing ────────────────── */

test('mutation 1 — a whitelisted write does not count (notifications / chat_reads / partner_clicks)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: {
      'src/a.js':
        writes(1) +
        `await supabase.from('notifications').update({ read: true }).eq('id', id);\n` +
        `await supabase.from('chat_reads').upsert(row);\n` +
        `await supabase.from('partner_clicks').insert(payload);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `бельй список не сработал:\n${r.out}`);
});

test('the whitelist is PRINTED, so it is never silent', (t) => {
  const f = fixture(t, { base: { 'src/a.js': `await supabase.from('chat_reads').upsert(r);\n` }, head: {} });
  const r = run(f);
  assert.match(r.out, /по белому списку 1/, r.out);
});

/* ───────────── mutation 2: comments must be blanked ─────────────────────── */

test('mutation 2 — a call inside a comment does not count', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: {
      'src/a.js':
        writes(1) +
        `// await supabase.from('budget_expenses').insert({ x: 1 });\n` +
        `/* await supabase.rpc('add_city'); */\n` +
        `/**\n * .from('trip_budgets').update() in a doc block\n */\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `комментарии посчитались как вызовы:\n${r.out}`);
});

test('a comment marker inside a STRING is not a comment', (t) => {
  // Blanking has to know where strings are, or `'//'` truncates the rest of the
  // line and the real call after it disappears — a false GREEN.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `const u = 'https://x/y'; await supabase.from('budget_expenses').insert(r);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `вызов после строки с // пропал:\n${r.out}`);
});

test('mutation 16 — a regex literal containing `//` does not eat the rest of the line', (t) => {
  // The header calls this the main hole the blanker closes, and nothing pinned
  // it. Without the regex branch the `//` inside `/^https:\/\//` opens a line
  // comment, the call after it on the SAME line is blanked away, and the guard
  // goes GREEN on a write it never saw.
  //
  // Its known limit is the mirror image and is named as hole 6: the branch keys
  // on the previous significant CHARACTER, so `return /https:\/\//.test(u)`
  // (keyword, not character) still loses its line. Today the tree has no such
  // site — all five `return /…/` are `//`-free.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: {
      'src/a.js':
        `const abs = /^https:\\/\\//.test(u); await supabase.from('budget_expenses').insert(r);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `регулярка с // съела вызов на своей строке — ложный ЗЕЛЁНЫЙ:\n${r.out}`);
});

test('mutation 17 — an emoji earlier in the file does not shift the blanking', (t) => {
  // The blanker indexes `src[i]` (UTF-16 code UNITS) but built its output with
  // `Array.from` (code POINTS). Every surrogate pair before a comment therefore
  // slid the blanked window one unit right: the comment's own `//` survived and
  // the same number of characters of the NEXT line were destroyed instead.
  //
  // Three emoji is enough to eat `.f` off a chain continuation, turning
  // `.from('budget_expenses')` into `rom('budget_expenses')` — the write is not
  // miscounted, it is INVISIBLE, and the guard goes green. `src/**` has three
  // such files today (CountryFlag, TimezoneHint, TripCoverPicker), which is why
  // this is a fixture and not a footnote. 2l and 2n use `split('')`.
  const f = fixture(t, {
    base: { 'src/a.jsx': '' },
    head: {
      'src/a.jsx':
        `const e = '\u{1F600}\u{1F600}\u{1F600}';\n` +
        `const q = await supabase\n` +
        `// выбираем таблицу\n` +
        `.from('budget_expenses')\n` +
        `.insert(row);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `запись после эмодзи стала невидимой — ложный ЗЕЛЁНЫЙ:\n${r.out}`);
  assert.match(r.out, /✗ прямых записей \(таблица литералом\): 0 → 1/, r.out);
});

/* ───────────── mutation 3: every metric ratchets, not just the first ───── */

test('mutation 3 — growth in a LATER metric is caught (not only the first)', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': rawErrors(1) },
    head: { 'supabase/functions/f/index.ts': rawErrors(3) },
  });
  const r = run(f);
  assert.equal(r.code, 1, `рост сырых ответов не пойман:\n${r.out}`);
  assert.match(r.out, /сырых ответов/);
});

test('two metrics growing at once are BOTH reported', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1), 'supabase/functions/f/index.ts': rawErrors(1) },
    head: { 'src/a.js': writes(2), 'supabase/functions/f/index.ts': rawErrors(2) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /прямых записей/);
  assert.match(r.out, /сырых ответов/);
});

test('mutation 14 — a literal-table READ is counted, on its own metric', (t) => {
  // ⚠ `reads` (9 on dev) was the one ratchet metric no assertion touched:
  // deleting `m.reads++` outright left all 43 tests green. A metric nothing
  // pins is a metric that can quietly become 0 — which reads as "the epic is
  // finished", the most expensive false green this board can print.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `const { data } = await supabase.from('trips').select('*').eq('id', id);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `прямое чтение литералом не посчитано:\n${r.out}`);
  assert.match(r.out, /✗ прямых чтений \(таблица литералом\): 0 → 1/, r.out);
});

/* ───────────── mutation 4: the table behind a variable ──────────────────── */

test('mutation 4 — a write with a VARIABLE table is counted (its own number)', (t) => {
  // 5 of the epic's writes look like this (`ENTITY_TABLE_BY_KIND[kind]`), and
  // they are the largest single block of §4.C. A literal-name predicate sees
  // none of them. A hole named in the header does not ratchet; a hole named as
  // a NUMBER does.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `const table = MAP[kind];\nawait supabase.from(table).insert(payload);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `запись через переменную невидима:\n${r.out}`);
  assert.match(r.out, /через переменную/);
});

test('a READ with a variable table has its own number too', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `await supabase.from(table).select('*').eq('id', id);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /через переменную/);
});

/* ───────────── mutation 5: grep is line-based, a regex need not be ──────── */

test('mutation 5 — a multi-line chain is counted', (t) => {
  // 17 of 44 `.from()` sites in the real repo put the operation on the NEXT
  // line. A single-line predicate misses every one of them.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: {
      'src/a.js':
        `const { data } = await supabase\n` +
        `  .from('budget_expenses')\n` +
        `  .insert(row)\n` +
        `  .select();\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `многострочная цепочка пропущена:\n${r.out}`);
});

test('a multi-line RPC call is counted', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `await supabase.rpc(\n  'send_chat_message',\n  { p: 1 },\n);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /мутирующих RPC/);
});

/* ───────────── mutation 6: a refusal has more than one shape ────────────── */

test('mutation 6a — `ok: false` at 200 counts as a raw error response', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return Response.json({ ok: false, code: 'FORBIDDEN' }, { headers });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `отказ статусом 200 не посчитан:\n${r.out}`);
});

test('mutation 6b — `allow: false` counts too (aiGate has this third shape)', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return Response.json({ allow: false, message: m }, { headers });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
});

test('mutation 6c — the two-argument form with the body on the next line counts', (t) => {
  // `deleteTrip:76`, `viatorActivities:100`, `stay22Accommodations:92` are real
  // `{ error }` responses that the single-line `Response.json({ error` grep
  // (the 167) does not see.
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: {
      'supabase/functions/f/index.ts':
        `return Response.json(\n  { error: 'upstream' },\n  { status: 502, headers: corsHeaders },\n);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `двухаргументная форма пропущена:\n${r.out}`);
});

test('mutation 11 — status >= 400 counts even with NO refusal key in the body', (t) => {
  // `deleteMyAccount` has FIVE of these: `{ code: 'unauthorized' }` at 401 —
  // a FOURTH refusal shape, carrying neither `error` nor `ok:false` nor
  // `allow:false`. Only the status branch sees them. The first version of the
  // 6c test paired a status with an `error` key, so the key branch answered
  // first and this branch was never exercised.
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return Response.json({ code: 'unauthorized' }, { status: 401, headers });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `отказ по статусу без ключа-отказа пропущен:\n${r.out}`);
});

test('a SUCCESS response is not an error response', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: {
      'supabase/functions/f/index.ts':
        `return Response.json({ ok: true, trips }, { headers });\n` +
        `return Response.json(\n  { activities, meta: { total } },\n  { headers },\n);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `успешный ответ посчитан отказом:\n${r.out}`);
});

test('a refusal nested deeper than the top level is not a refusal', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return Response.json({ meta: { error: null }, rows }, { headers });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, `вложенный ключ прочитан как отказ:\n${r.out}`);
});

test('the canonical helper itself is not counted as raw', (t) => {
  // `_shared/http.ts` IS the canon; the `Response.json` inside `jsonError` is
  // the thing every other site is supposed to route through.
  const f = fixture(t, {
    base: { 'supabase/functions/_shared/http.ts': '' },
    head: {
      'supabase/functions/_shared/http.ts':
        `export function jsonError(status, message, code, headers) {\n` +
        `  return Response.json({ error: message, code }, { status, headers });\n` +
        `}\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `канон посчитан сырым ответом:\n${r.out}`);
});

test('a canonical jsonError call site is not counted', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return jsonError(403, 'nope', 'FORBIDDEN', corsHeaders);\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

/* ───────────── mutation 10: a bucket is not a table ─────────────────────── */

test('mutation 10 — storage.from is not a table write', (t) => {
  // The bucket `trips` and the table `trips` share a NAME, and `update` is a
  // real Storage method that is ALSO in the write-op set — so without the
  // `storage` check this call lands on the TABLE `trips` and invents a
  // double-door entry, on the one metric whose target is 0.
  //
  // ⚠ The first version of this test used `.remove()` / `.upload()` /
  // `.createSignedUrl()` and was INERT: those ops are dropped by the op filter
  // anyway, so deleting the storage check changed nothing and the test stayed
  // green. A mutation found that, not a review — same failure as the catalog
  // test in TRIP-340.
  const f = fixture(t, {
    base: { 'src/a.js': '', 'supabase/functions/f/index.ts': edgeWrite('trips') },
    head: {
      'src/a.js':
        `await supabase.storage.from('trips').update(p, file);\n` +
        `await supabase.storage.from('avatars').upload(p, f);\n` +
        `const { data } = await supabase.storage\n  .from(TRIP_BUCKET)\n  .createSignedUrl(p, ttl);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `бакет посчитан таблицей:\n${r.out}`);
  assert.doesNotMatch(r.out, /две двери записи/, `бакет создал фантомную двойную дверь:\n${r.out}`);
});

/* ───────────────────────── A4: two doors at once ────────────────────────── */

test('a table written from BOTH the browser and edge is reported, with its NAME', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': '', 'supabase/functions/f/index.ts': '' },
    head: {
      'src/a.js': `await supabase.from('city_visits').insert(rows);\n`,
      'supabase/functions/f/index.ts': edgeWrite('city_visits'),
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /city_visits/, `A4 напечатала число без списка таблиц:\n${r.out}`);
});

test('mutation 15 — a DECLARED two-door table is reported apart from the ratchet', (t) => {
  // The starred decision in `measure()`: `notifications` is written by the
  // browser (the `read` flag) AND by edge, and by §4.C that stays forever — so
  // it must not sit on the metric whose target is 0, because an unreachable
  // target is not a metric. Folding the whitelist back into `doubleDoor` left
  // every test green while turning the live repo red for a reason nobody could
  // act on. Not silent, though: it gets its own printed line.
  const f = fixture(t, {
    base: { 'src/a.js': '', 'supabase/functions/f/index.ts': '' },
    head: {
      'src/a.js': `await supabase.from('notifications').update({ read: true }).eq('id', id);\n`,
      'supabase/functions/f/index.ts': edgeWrite('notifications'),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `объявленное исключение попало в ратчет с недостижимой целью:\n${r.out}`);
  assert.match(r.out, /две двери ПО ОБЪЯВЛЕНИЮ.*notifications/, `граница молчит — а молчащая граница хуже дыры:\n${r.out}`);
  assert.doesNotMatch(r.out, /две двери записи/, `объявленная таблица напечатана как нарушение:\n${r.out}`);
});

test('chat tables are out of the epic scope, read and write alike (§4.D)', (t) => {
  // Realtime checks the subscriber's own SELECT policy; revoking it would kill
  // the subscription, so the chat is not behind the door and its calls are not
  // counted on either metric.
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: {
      'src/a.js':
        `await supabase.from('chats').insert({ trip_id });\n` +
        `await supabase.from('chat_messages').select('*').eq('chat_id', id);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `чат посчитан прямым доступом:\n${r.out}`);
});

test('a table written only from edge is NOT a double door', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': edgeWrite('trip_members') },
  });
  const r = run(f);
  assert.equal(r.code, 0, `односторонняя запись прочитана как две двери:\n${r.out}`);
});

/* ─────────────────── printed, deliberately not ratcheted ───────────────── */

test('a NEW edge function does not fail the guard (the epic creates them)', (t) => {
  // A1 as an anti-ratchet would block Ф1 on its first PR — the epic's own plan
  // adds `getHomeScreen`, `saveEvent`, `saveExpense`… It is printed instead.
  // `_shared` is a library, not a function, so the count is 1 → 2 and not 2 → 3.
  const f = fixture(t, {
    base: {
      'supabase/functions/_shared/http.ts': 'export const jsonError = () => {};\n',
      'supabase/functions/a/index.ts': 'export {};\n',
    },
    head: { 'supabase/functions/b/index.ts': 'export {};\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, `A1 заблокировала создание функции:\n${r.out}`);
  assert.match(r.out, /edge-функций 2/, `_shared посчитан edge-функцией:\n${r.out}`);
});

test('the shared seam appearing does not fail the guard, but is printed', (t) => {
  const f = fixture(t, {
    base: {},
    head: { 'supabase/functions/_shared/mutate.ts': 'export const write = () => {};\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, `A2 заблокировала появление шва — это и есть Ф1:\n${r.out}`);
  assert.match(r.out, /mutate\.ts/);
});

test('mutation 12 — home-screen calls are COUNTED, printed, and not ratcheted', (t) => {
  // ⚠ The first version asserted only `/главн/i`. That substring is printed
  // unconditionally, from a constant — so pointing the measurement at a file
  // that does not exist (`homeScreenCalls` permanently 0) left all 43 tests
  // green. An assertion has to name the NUMBER, not the label.
  //
  // The fixture is deliberately built out of calls that no ratchet metric sees
  // (a whitelisted write + an edge call), so a non-zero exit could only come
  // from A3 being ratcheted — which is the other half of the name.
  //
  // `Array.from({ length })` in the card skeleton is the reason this metric
  // goes through `fromCalls` instead of a raw regex: counting it as a query is
  // what turned the epic's ballpark 4 into 6 (M5 in the guard's header).
  const f = fixture(t, {
    base: { 'src/pages/Trips.jsx': '' },
    head: {
      'src/pages/Trips.jsx':
        `await supabase.from('notifications').update({ read: true }).eq('id', id);\n` +
        `const { trips } = await invokeFn('getHomeScreen', {});\n` +
        `const skeleton = Array.from({ length: 6 }).map((_, i) => i);\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `A3 ратчетится — а она пофайловая и обходится выносом в хук:\n${r.out}`);
  assert.match(r.out, /вызовов на главной \(Trips\.jsx\) 2/, `A3 не посчитана (или Array.from сошла за запрос):\n${r.out}`);
});

test('the edge-call seam does not count its own declaring module', (t) => {
  const f = fixture(t, {
    base: {},
    head: {
      'src/lib/invokeFn.js': `export async function invokeFn(name, body) { return call(name, body); }\n`,
      'src/pages/X.jsx': `await invokeFn('saveEvent', payload);\n`,
    },
  });
  const r = run(f);
  assert.match(r.out, /точек вызова 1/, `модуль, ОБЪЯВЛЯЮЩИЙ шов, посчитан его точкой вызова:\n${r.out}`);
});

/* ──────────────────────────── the RPC manifest ─────────────────────────── */

test('an RPC nobody classified is a violation, not a silent bucket', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': '' },
    head: { 'src/a.js': `await supabase.rpc('brand_new_thing', { a: 1 });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /brand_new_thing/);
});

test('mutation 13 — the three RPC buckets get one call EACH, not three in one', (t) => {
  // ⚠ The first version asserted the three LABELS were printed. They are
  // printed from the METRICS table on every run, so folding all three buckets
  // into `rpcMutating` kept this test green. The gazetteer bucket is the one
  // that matters most here: it is the only metric whose target is not 0 (it
  // stays client-side, §4.B), so misfiling a name into it — or out of it —
  // moves the distance-to-target arithmetic and nothing else would notice.
  const f = fixture(t, {
    base: {
      'src/a.js':
        `await supabase.rpc('send_chat_message', {});\n` +
        `await supabase.rpc('get_user_travel_stats');\n` +
        `await supabase.rpc('search_gazetteer', {});\n`,
    },
    head: {},
  });
  const r = run(f);
  assert.match(r.out, /мутирующих RPC с клиента\s+1 →\s+1/, `мутирующая корзина не 1:\n${r.out}`);
  assert.match(r.out, /читающих RPC с клиента\s+1 →\s+1/, `читающая корзина не 1:\n${r.out}`);
  assert.match(r.out, /RPC газеттира \(остаются\)\s+1 →\s+1/, `газеттир не 1:\n${r.out}`);
});

test('a reading RPC moving behind edge lowers its own bucket, not the mutating one', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': `await supabase.rpc('get_user_travel_stats');\nawait supabase.rpc('send_chat_message', {});\n` },
    head: { 'src/a.js': `await supabase.rpc('send_chat_message', {});\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /читающих RPC\s+1 → 0|читающих RPC.*-1/s, r.out);
});

/* ─────────────────────────────── exemptions ────────────────────────────── */

test('door-exempt in an ADDED line under the scanned tree grants exactly that budget', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(2) + `// door-exempt: writes +1 — временный шим Ф2, апрув Pavel\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, `маркер не сработал:\n${r.out}`);
  assert.match(r.out, /door-exempt \+1/);
});

test('the marker covers only the amount it names', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(3) + `// door-exempt: writes +1 — причина\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `маркер на +1 покрыл рост на +2:\n${r.out}`);
});

test('mutation 7 — a marker OUTSIDE the pathspec is ignored', (t) => {
  // Guard 2o failed with exit 2 on its own introducing PR because it read
  // markers repo-wide and its own test fixtures looked like real exemptions.
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(2), 'memory/note.md': `door-exempt: writes +1 — из памяти\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `маркер из memory/ выдал бюджет:\n${r.out}`);
});

test('a marker that is already on the base grants nothing (it must be ADDED)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) + `// door-exempt: writes +1 — прошлый PR\n` },
    head: { 'src/a.js': writes(2) + `// door-exempt: writes +1 — прошлый PR\n` },
  });
  const r = run(f);
  assert.equal(r.code, 1, `унаследованный маркер выдал бюджет второй раз:\n${r.out}`);
});

test('a marker naming an unknown metric is an ERROR, not a no-op', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(2) + `// door-exempt: wrties +1 — опечатка\n` },
  });
  const r = run(f);
  assert.equal(r.code, 2, `опечатка прочиталась как «исключений не просили»:\n${r.out}`);
  assert.match(r.out, /wrties/);
});

test('mutation 18 — a marker that does not PARSE is an error, not silence', (t) => {
  // `door-exempt: writes 1` (no `+`) does not match the regex. Without an
  // explicit check the line grants nothing SILENTLY: the author wrote an
  // exemption, sees red, and has no idea why — while the header promises that
  // a typo never reads as "no exemption requested".
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(2) + `// door-exempt: writes 1 — забыл плюс\n` },
  });
  const r = run(f);
  assert.equal(r.code, 2, `нераспознанный маркер промолчал:\n${r.out}`);
  assert.match(r.out, /не разобрался/);
});

test('mutation 19 — an UNBALANCED bracket inside a string does not hide the call', (t) => {
  // ⚠ The first version of this test used `{ error: 'нет доступа (403)' }` and
  // was INERT: even sliced short, the body still starts with `error`, so the
  // key branch answered and the refusal was counted anyway. The mutation went
  // through green — the same inert shape as the storage test before it.
  //
  // The case that actually changes the verdict needs BOTH: an unbalanced
  // bracket (so `matchParen` never closes and the site is skipped ENTIRELY)
  // and a body with no refusal key (so only the status branch could have seen
  // it). Then a real 401 becomes invisible — a false GREEN.
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: {
      'supabase/functions/f/index.ts':
        `return Response.json({ code: 'unauthorized (' }, { status: 401, headers });\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, `скобка из текста сообщения спрятала отказ целиком:\n${r.out}`);
});

test('mutation 19b — a comma inside a string does not create a second argument', (t) => {
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': '' },
    head: { 'supabase/functions/f/index.ts': `return Response.json({ ok: true, note: 'a, b, c' }, { headers });\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, `успешный ответ с запятой в строке прочитан отказом:\n${r.out}`);
});

test('mutation 20 — an UNREADABLE tree is RED, not an empty one', (t) => {
  // A bare `catch` swallowed every error, not just "no such directory": an
  // unreadable `src/` yields 0 files on BOTH sides, every delta is zero, and
  // the board prints "ратчет держится" — "could not measure" wearing "measured,
  // clean"'s clothes, which this guard's own header forbids.
  //
  // `src` as a regular FILE gives ENOTDIR deterministically, with no chmod and
  // no dependence on whether the runner is root.
  const f = fixture(t, {
    base: { 'supabase/functions/f/index.ts': 'export {};\n' },
    head: { 'src': 'это файл, а не каталог\n' },
  });
  const r = run(f);
  assert.equal(r.code, 2, `нечитаемое дерево напечатало «чисто»:\n${r.out}`);
  assert.doesNotMatch(r.out, /держится/, r.out);
});

/* ──────────────────────── cannot measure ⇒ RED, not OK ─────────────────── */

test('mutation 9 — an unresolvable BASE_REF is RED, never a skip', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(1) }, head: {} });
  const r = run(f, { ref: 'origin/does-not-exist' });
  assert.equal(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /OK|держится/, `табло напечатало «ок», ничего не измерив:\n${r.out}`);
});

test('mutation 8 — no worktree leaks on a die() path', (t) => {
  // `die()` calls `process.exit`, which does NOT unwind the stack: a `finally`
  // is skipped on exactly the failure paths that leak. 2o shipped with that bug
  // and its test only covered the exit-1 path, which runs after the block.
  const f = fixture(t, {
    base: { 'src/a.js': writes(1) },
    head: { 'src/a.js': writes(2) + `// door-exempt: nonsense +1 — умрёт после worktree add\n` },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
  const list = git(f.dir, ['worktree', 'list']);
  assert.equal(list.trim().split('\n').length, 1, `ворктри утекла:\n${list}`);
});

test('running from a subdirectory measures the whole repo, not nothing', (t) => {
  // 2l printed `0 changed file(s) — OK` on any amount of dirt when run from a
  // subdirectory. "Nothing to check" and "checked, clean" must differ.
  const f = fixture(t, { base: { 'src/a.js': writes(1) }, head: { 'src/a.js': writes(2) } });
  const r = run(f, { cwd: 'src' });
  assert.equal(r.code, 1, `из подкаталога гард ничего не увидел:\n${r.out}`);
});

/* ──────────────────────────── the TARGET half ──────────────────────────── */

test('--assert-target fails while the distance to the epic target is not zero', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(2) }, head: {} });
  const plain = run(f);
  const target = run(f, { args: ['--assert-target'] });
  assert.equal(plain.code, 0, `ратчет должен быть зелёным без роста:\n${plain.out}`);
  assert.equal(target.code, 1, `табло не покраснело на живой дистанции:\n${target.out}`);
});

test('--assert-target passes once every target is met', (t) => {
  const f = fixture(t, { base: {}, head: {} });
  const r = run(f, { args: ['--assert-target'] });
  assert.equal(r.code, 0, r.out);
});

test('the distance to target is printed in the DEFAULT run too', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(2) }, head: {} });
  const r = run(f);
  assert.match(r.out, /до цели/i, `дистанция печатается только под флагом:\n${r.out}`);
});

/* ──────────────────────────────── plumbing ─────────────────────────────── */

test('--json prints every field the ratchet reads', (t) => {
  const f = fixture(t, { base: { 'src/a.js': writes(1) }, head: {} });
  const r = spawnSync(process.execPath, [GUARD, '--json'], { cwd: f.dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  for (const k of [
    'rpcMutating', 'rpcReading', 'rpcGazetteer', 'writes', 'writesVar',
    'reads', 'readsVar', 'rawErrors', 'doubleDoor',
  ]) {
    assert.ok(Object.hasOwn(j, k), `нет поля ${k} в --json`);
  }
  assert.ok(Array.isArray(j.doubleDoor), 'doubleDoor обязан быть СПИСКОМ таблиц, не числом');
});

test('an unknown flag is refused (there is no baseline and no --write)', (t) => {
  const f = fixture(t, { base: {}, head: {} });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2, r.out);
});
