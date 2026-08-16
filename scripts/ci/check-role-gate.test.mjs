import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Гард — код, у него тест: временное дерево, гард подпроцессом, код выхода.
// Зелёный тест ничего не значит, пока не увидел красным — здесь оба случая.
const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-role-gate.mjs');

function runGuard(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rolegate-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    try {
      execFileSync('node', [GUARD, dir], { encoding: 'utf8' });
      return { code: 0 };
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('КРАСНЫЙ: рукописный гейт роли мимо лестницы роняет гард', () => {
  const r = runGuard({ 'Foo.jsx': "const readOnly = myRole === 'viewer';\n" });
  assert.equal(r.code, 1);
  assert.match(r.out, /Foo\.jsx/);
});

test('КРАСНЫЙ: сравнение с trip.created_by тоже гейт', () => {
  const r = runGuard({ 'Bar.jsx': "const isOwner = user.id === trip.created_by;\n" });
  assert.equal(r.code, 1);
});

test('ЗЕЛЁНЫЙ: гейт через лестницу проходит', () => {
  const r = runGuard({ 'Ok.jsx': "const readOnly = !clearsStep(myStep, 'editor');\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: `.role` РЯДА (показ/сортировка) — не гейт', () => {
  const r = runGuard({ 'Row.jsx': "const isOwner = m.role === 'owner';\nconst label = member.role === 'admin' ? 'A' : 'B';\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: `d.created_by === user.id` (свои доки) — не гейт роли', () => {
  const r = runGuard({ 'Docs.jsx': "const mine = docs.filter(d => d.created_by === user.id);\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: маркер role-gate-exempt разрешает показ роли', () => {
  const r = runGuard({ 'Badge.jsx': "if (role === 'owner') return <b/>; // role-gate-exempt: показ\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: комментарий с role === не считается гейтом', () => {
  const r = runGuard({ 'C.jsx': "// раньше было role === 'admin', теперь лестница\nconst x = 1;\n" });
  assert.equal(r.code, 0);
});
