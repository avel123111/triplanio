#!/usr/bin/env node
/**
 * Tests for CI guard 2ab (scripts/ci/check-confirm-copy.mjs).
 *
 * Per the project rule "a CI guard is code: it gets a test" (TRIP-282): a green
 * guard proves nothing until it has been seen RED. Each case builds a throwaway
 * tree with a `src/` folder, runs the guard as a subprocess with cwd pointing at
 * it (the guard walks the relative `src` root, like 2e/2f), and asserts the exit
 * code + offender output. The RED cases are the point — they fail the mutation
 * the guard exists to catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-confirm-copy.mjs', import.meta.url));

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

// Build a temp tree from { relpath: body }, run the guard there, return result.
function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'confirm-guard-'));
  try {
    for (const [p, body] of Object.entries(files)) put(dir, p, body);
    const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('passes when every confirm has title + description (nested + quoted keys)', () => {
  const r = run({
    'src/a.jsx': `
      confirm({ title: t('x'), description: t('y'), onConfirm: async () => { await z({ a: 1 }); } });
      confirm({ 'title': t('x'), "description": t('y') });
    `,
  });
  assert.equal(r.code, 0, r.out);
});

test('RED: fails when description is missing', () => {
  const r = run({ 'src/a.jsx': `confirm({ title: t('x'), variant: 'destructive' });` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a\.jsx:1 — confirm\(\) missing description/);
});

test('RED: fails when title is missing', () => {
  const r = run({ 'src/a.jsx': `confirm({ description: t('y') });` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /missing title/);
});

test('ignores window.confirm(string) — not the useConfirm object form', () => {
  const r = run({ 'src/a.jsx': `window.confirm('are you sure?');` });
  assert.equal(r.code, 0, r.out);
});

test('skips the seam files (they define the contract, not call it)', () => {
  const r = run({
    'src/components/common/ConfirmProvider.jsx': `confirm({ title: t('x') });`,
    'src/components/common/ConfirmDialog.jsx': `confirm({ title: t('x') });`,
  });
  assert.equal(r.code, 0, r.out);
});
