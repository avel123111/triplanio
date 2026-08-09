#!/usr/bin/env node
/**
 * Tests for CI guard 2u (scripts/ci/check-css-comments.mjs), TRIP-344.
 *
 * Half the tests exercise the pure scanner `scanCss` directly (fast, table-driven);
 * two exercise the guard end-to-end as a subprocess against a throwaway git repo,
 * the way CI runs it (template from check-inline-styles.test.mjs, TRIP-282).
 *
 * ★ Каждый зелёный проверен красным (TRIP-282): в конце — мутации, возвращающие
 * предикат к дырявому виду, и они ОБЯЗАНЫ ронять ровно свой кейс. И честно
 * закреплена ГРАНИЦА: «сцеленная» форма (правило впитано, файл сбалансирован) тут
 * НЕ ловится — тест это фиксирует, чтобы граница не уехала молча.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCss } from './check-css-comments.mjs';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-css-comments.mjs');

// ── unit: pure scanner ──────────────────────────────────────────────────────
const RED = [
  ['осиротевший терминатор (лишний */)', '/* text */ trap */\n.k{z:3}\n'],
  ['две ошибки, но лишний */ виден', '.a{c:red}\n/* nc\n.k1{x:1}\n/* t */ lit */\n.b{c:blue}\n'],
  ['незакрытый комментарий на конце файла', '.a{c:red}\n/* never closed\n.k{x:1}\n'],
];
const GREEN = [
  ['здоровый файл', '.a{color:red}\n/* note */\n.b{color:blue}\n'],
  ['удаление правила (нет комментария вовсе)', '.a{c:red}\n.c{c:g}\n'],
  ['content со звёздочкой-слэшем в строке', '.a::after{content:"*/"}\n.b{c:blue}\n'],
  ['файл-глоб внутри комментария', '/* files {a,b}/*.woff2 here */\n.a{c:red}\n'],
  ['журнал 2p цитирует {@media …}', '/* JOURNAL: .x:hover {@media (hover:hover)} bg; .y {@media} color */\n.a{c:red}\n'],
];

for (const [name, css] of RED) {
  test(`RED — ${name}`, () => {
    assert.ok(scanCss(css).length > 0, `ожидалась находка:\n${css}`);
  });
}
for (const [name, css] of GREEN) {
  test(`GREEN — ${name}`, () => {
    assert.equal(scanCss(css).length, 0, `ложное срабатывание:\n${css}\n${JSON.stringify(scanCss(css))}`);
  });
}

// ★ Честная ГРАНИЦА: «сцеленная» форма (терминатор съеден, закрыт следующим
// комментарием — файл сбалансирован, правило впитано) тут НЕ ловится. Это ровно
// форма живого бага TRIP-344; её держит рендер в приёмке, не этот гард. Тест
// фиксирует границу, чтобы она не сместилась незаметно (в обе стороны).
test('ГРАНИЦА — сцеленная форма (впитанное правило) НЕ ловится, и это задокументировано', () => {
  const healed = '.a{c:red}\n/* marker без закрытия\n.dot{position:absolute}\n/* next */\n.b{c:blue}\n';
  assert.equal(scanCss(healed).length, 0);
});

// ── мутации: зелёный ничего не значит, пока не увидел красным (TRIP-282) ──────
test('мутация — без правила «осиротевший */» кейс проходит (значит тест его и держит)', () => {
  const withoutStray = (css) => scanCss(css).filter((f) => f.kind !== 'осиротевший терминатор комментария */');
  assert.equal(withoutStray('/* a */ x */\n').length, 0, 'этот кейс держит только правило про осиротевший */');
});
test('мутация — без правила «незакрытый» кейс проходит (значит тест его и держит)', () => {
  const withoutUnclosed = (css) => scanCss(css).filter((f) => f.kind !== 'незакрытый комментарий /*');
  assert.equal(withoutUnclosed('.a{c:red}\n/* never closed\n').length, 0, 'этот кейс держит только правило про незакрытый');
});

// ── e2e: гард как подпроцесс над одноразовым git-репо ────────────────────────
function runGuardIn(files) {
  const dir = mkdtempSync(join(tmpdir(), 'css-comments-'));
  try {
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    git(['config', 'user.email', 't@t.t']);
    git(['config', 'user.name', 't']);
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    git(['add', '-A']);
    git(['commit', '-qm', 'fixture']);
    const r = execFileSync('node', [GUARD], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: r };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('e2e — чистый CSS: exit 0', () => {
  const { code } = runGuardIn({ 'src/a.css': '.a{color:red}\n/* ok */\n.b{color:blue}\n' });
  assert.equal(code, 0);
});
test('e2e — лишний */ в файле: exit 1', () => {
  const { code, out } = runGuardIn({ 'src/a.css': '/* a */ stray */\n.b{color:blue}\n' });
  assert.equal(code, 1, out);
  assert.match(out, /осиротевший терминатор/);
});
