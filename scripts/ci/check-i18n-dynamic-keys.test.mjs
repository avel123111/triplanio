#!/usr/bin/env node
/**
 * Tests for CI guard 2q (scripts/ci/check-i18n-dynamic-keys.mjs).
 *
 * A green test proves nothing until it has been seen red: the mutation that
 * matters here is TRIP-299 — a locale key that is alive only through the DB /
 * n8n gets deleted, and nothing catches it. `protected key deleted from every
 * locale` and `emit() with no family` are that mutation; both must fail.
 *
 * The guard reads `src/lib/i18n/locales` and `supabase/functions` relative to
 * cwd, so each case builds a throwaway tree and runs the guard from it — no git
 * needed (the guard is a global invariant, not a diff).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTECTED_KEYS } from './check-i18n-dynamic-keys.mjs';

const GUARD = fileURLToPath(new URL('./check-i18n-dynamic-keys.mjs', import.meta.url));
const LOCALES = ['en', 'ru', 'es'];

// Every protected key as a bare `notif.json` entry — the baseline "all present".
const baseNotif = () =>
  Object.fromEntries(PROTECTED_KEYS.map((k) => [k.slice('notif.'.length), 'value']));

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * Build a fixture tree.
 *  - notif:  locale -> object (defaults to all protected keys, per locale)
 *  - n8n:    locale -> object (n8n.json contents; omitted when empty)
 *  - fns:    { name: tsSource } edge-function files
 *  - noLocales: skip writing the locales dir entirely
 */
function fixture(t, { notif, n8n = {}, fns = {}, noLocales = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2q-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (!noLocales) {
    for (const loc of LOCALES) {
      const n = notif?.[loc] ?? baseNotif();
      put(dir, `src/lib/i18n/locales/${loc}/notif.json`, JSON.stringify(n));
      if (n8n[loc]) put(dir, `src/lib/i18n/locales/${loc}/n8n.json`, JSON.stringify(n8n[loc]));
    }
  }
  for (const [name, body] of Object.entries(fns)) put(dir, `supabase/functions/${name}`, body);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ─────────────────────────── the TRIP-299 mutation ──────────────────────── */

test('a protected key deleted from EVERY locale fails (the whole point)', (t) => {
  const notif = {};
  for (const loc of LOCALES) {
    const n = baseNotif();
    delete n.tpl_pro_payment_failed_title; // the notice TRIP-299 actually dropped
    notif[loc] = n;
  }
  const r = run(fixture(t, { notif }));
  assert.equal(r.code, 1);
  assert.match(r.out, /tpl_pro_payment_failed_title/);
});

test('a protected key missing in ONE locale fails', (t) => {
  const notif = { en: baseNotif(), ru: baseNotif(), es: baseNotif() };
  delete notif.es.tpl_joined_title;
  const r = run(fixture(t, { notif }));
  assert.equal(r.code, 1);
  assert.match(r.out, /tpl_joined_title.*es/s);
});

/* ─────────────────────────── n8n emit families ──────────────────────────── */

const N8N_INVITE = { 'invite_created.title': 't', 'invite_created.body': 'b' };
const emitFn = (ev) => `export default () => { await emit('${ev}'); };\n`;

test('emit(event) with a complete n8n family in every locale passes', (t) => {
  const n8n = { en: { ...N8N_INVITE }, ru: { ...N8N_INVITE }, es: { ...N8N_INVITE } };
  const r = run(fixture(t, { n8n, fns: { 'inviteTripMember/index.ts': emitFn('invite_created') } }));
  assert.equal(r.code, 0, r.out);
});

test('emit(event) with NO n8n.<event>.* family fails (typo or wiped family)', (t) => {
  const r = run(fixture(t, { fns: { 'x/index.ts': emitFn('ghost_event') } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /ghost_event/);
});

test('emit(event) whose family is missing in one locale fails', (t) => {
  const n8n = { en: { ...N8N_INVITE }, ru: { ...N8N_INVITE }, es: { 'invite_created.title': 't' } };
  const r = run(fixture(t, { n8n, fns: { 'x/index.ts': emitFn('invite_created') } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /invite_created\.body.*es/s);
});

test('double-quoted emit("event") is read too', (t) => {
  const n8n = { en: { ...N8N_INVITE }, ru: { ...N8N_INVITE }, es: { 'invite_created.title': 't' } };
  const r = run(fixture(t, { n8n, fns: { 'x/index.ts': 'await emit("invite_created");\n' } }));
  assert.equal(r.code, 1, r.out);
});

test('emit() inside a comment is prose, not a call', (t) => {
  const r = run(fixture(t, { fns: { 'x/index.ts': "// legacy: emit('ghost_event')\nexport default () => {};\n" } }));
  assert.equal(r.code, 0, r.out);
});

/* ─────────────────────────────── plumbing ───────────────────────────────── */

test('no emits and no n8n namespace at all → the protected list still passes', (t) => {
  const r = run(fixture(t));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 emit\(\) event/);
});

test('no locales dir is a measured-nothing error (exit 2), not a green OK', (t) => {
  const r = run(fixture(t, { noLocales: true, fns: { 'x/index.ts': 'const a=1;\n' } }));
  assert.equal(r.code, 2);
  assert.match(r.out, /no locales/i);
});

test('the guard has no committed exempt/bypass surface (edit PROTECTED_KEYS instead)', (t) => {
  const r = run(fixture(t, { fns: { 'x/index.ts': emitFn('ghost_event') } }));
  // An exempt marker in a function comment must NOT wave the failure through.
  const withMarker = run(
    fixture(t, { fns: { 'x/index.ts': `// dynamic-keys-exempt: ghost_event\n${emitFn('ghost_event')}` } }),
  );
  assert.equal(r.code, 1);
  assert.equal(withMarker.code, 1, 'there is deliberately no exempt escape');
});
