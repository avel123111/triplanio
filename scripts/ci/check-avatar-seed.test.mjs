#!/usr/bin/env node
/**
 * Tests for CI guard 2u (scripts/ci/check-avatar-seed.mjs).
 *
 * A guard is code; a green test means nothing until the guard has been seen RED.
 * Each case writes a throwaway fixture dir and runs the guard as a subprocess
 * pointed at it (the guard takes an optional scan root as argv[2]), asserting the
 * exit code — the way CI runs it. Same template as check-inline-styles.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-avatar-seed.mjs', import.meta.url));

/** Write one src/ file into a fresh temp root and run the guard against it. */
function runOn(body, t) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2u-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'F.jsx'), body);
  const r = spawnSync(process.execPath, [GUARD, join(dir, 'src')], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const wrap = (tag) => `export const C = () => (${tag});\n`;

/* ── the defect it exists to catch ─────────────────────────────────────────── */

test('dynamic name without seed FAILS (the DocsLens-class bug)', (t) => {
  const r = runOn(wrap('<Avatar name={who.name} photo={who.photo} />'), t);
  assert.equal(r.code, 1);
  assert.match(r.out, /dynamic name but no seed/);
});

test('dynamic name WITH seed passes', (t) => {
  assert.equal(runOn(wrap('<Avatar name={who.name} seed={who.seed} />'), t).code, 0);
});

/* ── legitimately exempt shapes ────────────────────────────────────────────── */

test('a string-literal name needs no seed (kit demo / decorative)', (t) => {
  assert.equal(runOn(wrap('<Avatar name="A B" />'), t).code, 0);
  assert.equal(runOn(wrap("<Avatar name={'A B'} />"), t).code, 0);
});

test('a kind-only avatar (ai) needs no seed', (t) => {
  assert.equal(runOn(wrap('<Avatar kind="ai" />'), t).code, 0);
});

test('kind + dynamic name needs no seed (placeholder/ai colour is irrelevant)', (t) => {
  assert.equal(runOn(wrap('<Avatar name={who.name} kind={who.kind} />'), t).code, 0);
});

/* ── the escape hatch ──────────────────────────────────────────────────────── */

test('exempt marker on the line before clears the violation', (t) => {
  const body = wrap('<>\n  {/* avatar-seed-exempt: public page has no id */}\n  <Avatar name={m.display_name} />\n</>');
  assert.equal(runOn(body, t).code, 0);
});

test('exempt marker on the same line clears the violation', (t) => {
  assert.equal(runOn(wrap('<Avatar name={m.display_name} /> {/* avatar-seed-exempt: x */}'), t).code, 0);
});

/* ── it must not fire on commented-out code ────────────────────────────────── */

test('a dynamic-name Avatar inside a comment is ignored', (t) => {
  assert.equal(runOn('// <Avatar name={who.name} />\nexport const C = 1;\n', t).code, 0);
});

/* ── regex-robustness: a `>` inside a prop must not truncate the tag ────────── */

test('an arrow BEFORE name does not hide a missing seed', (t) => {
  // The `>` of `=>` used to end the tag before `name` was seen → false pass.
  const r = runOn(wrap('<Avatar onClick={() => open()} name={who.name} photo={p} />'), t);
  assert.equal(r.code, 1);
});

test('a `>` compare inside a prop does not truncate the tag', (t) => {
  const r = runOn(wrap('<Avatar size={n > 3 ? "lg" : "sm"} name={who.name} />'), t);
  assert.equal(r.code, 1);
});

test('a nested self-closing element in a prop is not the tag end', (t) => {
  // `icon={<I/>}` contains `/>` inside braces; the real tag close is later, and
  // it carries seed → must pass.
  const r = runOn(wrap('<Avatar name={who.name} icon={<I/>} seed={who.seed} />'), t);
  assert.equal(r.code, 0);
});

/* ── regex-robustness: interpolation is dynamic, string values are not props ── */

test('an interpolated template name is dynamic and needs a seed', (t) => {
  const r = runOn(wrap('<Avatar name={`${who.name}`} />'), t);
  assert.equal(r.code, 1);
});

test('the literal "seed=" inside a string value is not a real seed prop', (t) => {
  const r = runOn(wrap('<Avatar name={who.name} aria-label="seed=warm" />'), t);
  assert.equal(r.code, 1);
});

/* ── a real repeat/negative: two tags, one bad ─────────────────────────────── */

test('one good and one bad tag still fails on the bad one', (t) => {
  const r = runOn(wrap('<><Avatar name={a.name} seed={a.seed} /><Avatar name={b.name} /></>'), t);
  assert.equal(r.code, 1);
});
