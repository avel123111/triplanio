import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EDITOR_ROLES, stepFromFacts, resolveMyStep, clearsStep } from './tripStep.js';

const OWNER = 'owner-uuid';
const trip = { id: 't1', created_by: OWNER };

// ── stepFromFacts — дословный миррор серверного правила ───────────────────────

test('stepFromFacts: creator is owner even with a stray viewer membership', () => {
  assert.equal(stepFromFacts(OWNER, OWNER, { role: 'viewer' }), 'owner');
});

test('stepFromFacts: no trip / no user → null', () => {
  assert.equal(stepFromFacts(null, OWNER, null), null);
  assert.equal(stepFromFacts(OWNER, null, null), null);
});

test('stepFromFacts: admin membership → editor', () => {
  assert.equal(stepFromFacts(OWNER, 'u2', { role: 'admin' }), 'editor');
});

test('stepFromFacts: viewer membership → participant', () => {
  assert.equal(stepFromFacts(OWNER, 'u3', { role: 'viewer' }), 'participant');
});

test('stepFromFacts: empty/unknown role → participant, never editor (white list)', () => {
  assert.equal(stepFromFacts(OWNER, 'u4', { role: null }), 'participant');
  assert.equal(stepFromFacts(OWNER, 'u4', { role: 'stranger' }), 'participant');
});

test('stepFromFacts: no membership row → null (not on trip)', () => {
  assert.equal(stepFromFacts(OWNER, 'nobody', null), null);
});

// ── resolveMyStep — active-only, creator wins, fail-closed ────────────────────

test('resolveMyStep: creator is owner with no membership row', () => {
  assert.equal(resolveMyStep([], trip, { id: OWNER }), 'owner');
});

test('resolveMyStep: pending/declined admin row does NOT grant editor (fail-closed)', () => {
  const members = [{ user_id: 'u2', role: 'admin', status: 'pending' }];
  assert.equal(resolveMyStep(members, trip, { id: 'u2' }), null);
});

test('resolveMyStep: active admin → editor, active viewer → participant', () => {
  const members = [
    { user_id: 'u2', role: 'admin', status: 'active' },
    { user_id: 'u3', role: 'viewer', status: 'active' },
  ];
  assert.equal(resolveMyStep(members, trip, { id: 'u2' }), 'editor');
  assert.equal(resolveMyStep(members, trip, { id: 'u3' }), 'participant');
});

test('resolveMyStep: stranger → null', () => {
  assert.equal(resolveMyStep([], trip, { id: 'nobody' }), null);
});

// ── clearsStep — вложенность и fail-closed на null ────────────────────────────

test('clearsStep: owner ⊃ editor ⊃ participant', () => {
  assert.equal(clearsStep('owner', 'participant'), true);
  assert.equal(clearsStep('owner', 'editor'), true);
  assert.equal(clearsStep('owner', 'owner'), true);
  assert.equal(clearsStep('editor', 'participant'), true);
  assert.equal(clearsStep('editor', 'editor'), true);
  assert.equal(clearsStep('editor', 'owner'), false);
  assert.equal(clearsStep('participant', 'participant'), true);
  assert.equal(clearsStep('participant', 'editor'), false);
});

test('clearsStep: null clears nothing (fail-closed)', () => {
  assert.equal(clearsStep(null, 'participant'), false);
  assert.equal(clearsStep(null, 'editor'), false);
  assert.equal(clearsStep(null, 'owner'), false);
});

// ── ПАРИТЕТ с сервером — тот же приём, что viralLink.js ↔ _shared/viralLink.ts ─
// Читаем серверный tripStep.ts как ТЕКСТ (импортировать нельзя — другой рантайм)
// и сверяем, что FE-копия правила не разошлась с ним.

const SERVER_SRC = readFileSync(
  fileURLToPath(new URL('../../supabase/functions/_shared/tripStep.ts', import.meta.url)),
  'utf8',
);

test('parity: FE EDITOR_ROLES === server EDITOR_ROLES', () => {
  const m = SERVER_SRC.match(/export const EDITOR_ROLES = \[([^\]]*)\]/);
  assert.ok(m, 'server EDITOR_ROLES not found — did tripStep.ts move?');
  const serverRoles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...EDITOR_ROLES].sort(), serverRoles.sort());
});

test('parity: FE ladder order === server LADDER', () => {
  const m = SERVER_SRC.match(/LADDER[^=]*=\s*\{([^}]*)\}/);
  assert.ok(m, 'server LADDER not found — did tripStep.ts move?');
  const serverLadder = Object.fromEntries(
    [...m[1].matchAll(/(\w+):\s*(\d+)/g)].map((x) => [x[1], Number(x[2])]),
  );
  // FE ступени должны ранжироваться идентично серверным.
  assert.equal(clearsStep('owner', 'editor'), serverLadder.owner >= serverLadder.editor);
  assert.equal(clearsStep('editor', 'participant'), serverLadder.editor >= serverLadder.participant);
  assert.equal(clearsStep('participant', 'editor'), serverLadder.participant >= serverLadder.editor);
});
