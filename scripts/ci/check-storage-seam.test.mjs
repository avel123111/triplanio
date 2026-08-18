/**
 * Тест гарда 2aa (check-storage-seam). Гард = код → у него тест: временное дерево,
 * гард ПОДПРОЦЕССОМ (cwd = дерево), ассерт кода выхода. Зелёный тест не значит
 * ничего, пока не увиден КРАСНЫМ на мутации — поэтому есть и «сырая запись без
 * маркера → 1», и «storage-report без report() → 1». См. [[triplanio-ci-guard-is-code]].
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-storage-seam.mjs', import.meta.url));

/** Разложить `{ 'src/x.js': '…' }` во временное дерево и прогнать гард с cwd=дерево. */
function runOn(files) {
  const root = mkdtempSync(join(tmpdir(), 'storage-seam-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return spawnSync('node', [GUARD], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const REPORTED_UPLOAD =
  `import { report } from '@/lib/reportDataError';\n` +
  `export async function up(b, f) {\n` +
  `  // storage-report: залив.\n` +
  `  const { error } = await supabase.storage.from('trips').upload('p', f);\n` +
  `  if (error) { report(error, { surface: 'storage', source: 'up' }); throw error; }\n` +
  `}\n`;

const SOFT_REMOVE =
  `export function sweep(paths) {\n` +
  `  // storage-soft-fail: подметание своих сирот.\n` +
  `  supabase.storage.from('trips').remove(paths).then(() => {}, () => {});\n` +
  `}\n`;

test('green — размеченные upload(report) + remove(soft-fail)', () => {
  const r = runOn({ 'src/a.js': REPORTED_UPLOAD, 'src/b.js': SOFT_REMOVE });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('green — чтения (createSignedUrl/getPublicUrl) не считаются записью', () => {
  const r = runOn({
    'src/reads.js':
      `export function u(p) {\n` +
      `  const { data } = supabase.storage.from('trips').createSignedUrl(p, 60);\n` +
      `  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(p);\n` +
      `  return [data, pub];\n` +
      `}\n`,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('green — многострочная цепочка storage.from().upload() с маркером', () => {
  const r = runOn({
    'src/multiline.js':
      `import { report } from '@/lib/reportDataError';\n` +
      `export async function up(f) {\n` +
      `  // storage-report: залив обложки.\n` +
      `  const { error } = await supabase.storage\n` +
      `    .from('trips')\n` +
      `    .upload('p', f, { upsert: true });\n` +
      `  if (error) { report(error, { surface: 'storage', source: 'cover' }); throw error; }\n` +
      `}\n`,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

// ── КРАСНЫЙ НА МУТАЦИИ — иначе зелёный ничего не доказывает ─────────────────────
test('red — сырая запись Storage без маркера → код 1', () => {
  const r = runOn({
    'src/raw.js':
      `export async function up(f) {\n` +
      `  const { error } = await supabase.storage.from('trips').upload('p', f);\n` +
      `  if (error) throw error;\n` +
      `}\n`,
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /нет маркера/);
});

test('red — // storage-report, но файл не зовёт report() → код 1', () => {
  const r = runOn({
    'src/lying.js':
      `export async function up(f) {\n` +
      `  // storage-report: якобы репортит.\n` +
      `  const { error } = await supabase.storage.from('trips').upload('p', f);\n` +
      `  if (error) throw error;\n` +
      `}\n`,
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /не зовёт report/);
});

test('red — move без маркера тоже ловится (не только upload)', () => {
  const r = runOn({
    'src/mv.js':
      `export async function mv(a, b) {\n` +
      `  const { error } = await supabase.storage.from('trips').move(a, b);\n` +
      `  return error;\n` +
      `}\n`,
  });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /\.move\(\)/);
});
