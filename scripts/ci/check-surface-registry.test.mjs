#!/usr/bin/env node
/**
 * Tests for CI guard 2z (scripts/ci/check-surface-registry.mjs).
 *
 * Каждый тест строит throwaway git-репо с `src/**`, `scripts/ci/surface-registry.json`
 * (читается относительно cwd) и запускает гард подпроцессом с BASE_REF на base-коммит.
 * Зелёный тест ничего не значит, пока не увидел КРАСНЫМ: первые три — незанесённый
 * класс, устаревшая запись, поверхность в <style> и рост инлайнов — гард ОБЯЗАН
 * поймать каждое.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-surface-registry.mjs', import.meta.url));
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const surfaceCss = (cls) => `.${cls} { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }`;
const reg = (obj) => JSON.stringify({ classes: obj });
const regHomed = (cardHomed) => JSON.stringify({ classes: {}, cardHomed });
const regTileHomed = (tileHomed) => JSON.stringify({ classes: {}, tileHomed });
const inlineSurface = (n) =>
  `export const C = () => <>${'<i style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16 }}/>'.repeat(n)}</>;\n`;
const inlineTile = (n) =>
  `export const C = () => <>${'<i style={{ background: "var(--brand-soft)", width: 38, height: 38 }}/>'.repeat(n)}</>;\n`;

function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2z-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);
  const put = (files) => {
    for (const [p, body] of Object.entries(files)) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
  };
  put(base);
  writeFileSync(join(dir, '.keep'), '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();
  put(head);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  return { dir, baseRef };
}

function run({ dir, baseRef }, ref) {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ── красное ─────────────────────────────────────────────────────────────── */

test('незанесённый surface-класс → красный', (t) => {
  const f = fixture(t, {
    base: { 'scripts/ci/surface-registry.json': reg({}), 'src/a.css': surfaceCss('widget-x') },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /widget-x/);
});

test('устаревшая запись (класс больше не поверхность) → красный', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({ 'ghost-x': { object: 'card', reason: 'нет такого' } }),
      'src/a.css': '.real { color: red; }',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ghost-x/);
});

test('поверхность в <style> внутри .jsx → красный', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({}),
      'src/a.jsx': 'export const C = () => (<><style>{`.p { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }`}</style></>);\n',
    },
  });
  assert.equal(run(f).code, 1);
});

test('рост surface-инлайнов против base → красный', (t) => {
  const f = fixture(t, {
    base: { 'scripts/ci/surface-registry.json': reg({}), 'src/a.jsx': inlineSurface(1) },
    head: { 'scripts/ci/surface-registry.json': reg({}), 'src/a.jsx': inlineSurface(4) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /инлайн/i);
});

test('сырой host-тег с card-homed классом мимо <Card> → красный (баг трансфера F)', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': regHomed(['tl3-card']),
      'src/a.jsx': 'export const C = () => (<button className="tl3-card tl3-card--tr" onClick={x}>y</button>);\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tl3-card/);
});

test('сырой host-тег с tile-homed классом мимо <Tile> → красный (TRIP-391 объект 3)', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': regTileHomed(['dl-empty__ic']),
      'src/a.jsx': 'export const C = () => (<div className="dl-empty__ic" />);\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /dl-empty__ic/);
});

test('рост инлайн-плиток против base → красный (TRIP-391 объект 3)', (t) => {
  const f = fixture(t, {
    base: { 'scripts/ci/surface-registry.json': reg({}), 'src/a.jsx': inlineTile(1) },
    head: { 'scripts/ci/surface-registry.json': reg({}), 'src/a.jsx': inlineTile(4) },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /инлайн-плит/i);
});

test('ко-селектор скин (фон+рамка общим правилом, радиус отдельно) незанесён → красный (TRIP-337 объект 2 замок)', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({}),
      // фон+рамку несёт ОБЩЕЕ (много-классовое) правило, радиус — отдельным:
      // per-rule предикат такое НЕ ловит, ко-селекторный замок ОБЯЗАН.
      'src/a.css': '.foo-card, .bar-card { background: var(--surface); border: 1px solid var(--line); }\n.foo-card { border-radius: 16px; }',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /foo-card/);
});

/* ── зелёное ─────────────────────────────────────────────────────────────── */

test('тот же ко-селектор скин, но занесён причиной → зелёный (TRIP-337 объект 2)', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({
        'foo-card': { object: 'card-backlog', reason: 'на общем скине, ждёт <Card>' },
        'bar-card': { object: 'card-backlog', reason: 'на общем скине, ждёт <Card>' },
      }),
      'src/a.css': '.foo-card, .bar-card { background: var(--surface); border: 1px solid var(--line); }\n.foo-card { border-radius: 16px; }\n.bar-card { border-radius: 16px; }',
    },
  });
  assert.equal(run(f).code, 0, run(f).out);
});


test('тот же tile-homed класс НА <Tile> → зелёный (TRIP-391 объект 3)', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': regTileHomed(['dl-empty__ic']),
      'src/a.jsx': 'export const C = () => (<Tile size="2xl" icon="file" className="dl-empty__ic" />);\n',
    },
  });
  assert.equal(run(f).code, 0, run(f).out);
});


test('тот же card-homed класс НА <Card> → зелёный', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': regHomed(['tl3-card']),
      'src/a.jsx': 'export const C = () => (<Card as="button" className="tl3-card tl3-card--tr">y</Card>);\n',
    },
  });
  assert.equal(run(f).code, 0, run(f).out);
});

test('каждый surface-класс приписан, инлайн падает → зелёный', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({ 'widget-x': { object: 'card', reason: 'ок' } }),
      'src/a.css': surfaceCss('widget-x'), 'src/a.jsx': inlineSurface(3),
    },
    head: {
      'scripts/ci/surface-registry.json': reg({ 'widget-x': { object: 'card', reason: 'ок' } }),
      'src/a.css': surfaceCss('widget-x'), 'src/a.jsx': inlineSurface(1),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('плитка (квадрат+радиус+фон) не поверхность → в реестре не нужна → зелёный', (t) => {
  const f = fixture(t, {
    base: {
      'scripts/ci/surface-registry.json': reg({}),
      'src/a.css': '.ic { width: 32px; height: 32px; border-radius: 8px; background: var(--fk); display: grid; place-items: center; }',
    },
  });
  assert.equal(run(f).code, 0, run(f).out);
});
