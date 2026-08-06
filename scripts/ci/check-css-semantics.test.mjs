#!/usr/bin/env node
/**
 * Тесты CI-гарда 2p (scripts/ci/check-css-semantics.mjs) — ярус 2 визуального
 * гейта, TRIP-340 PR3.
 *
 * Шаблон взят у 2l/2o: одноразовый git-репо, коммит «база», коммит «HEAD»,
 * гард запускается ПОДПРОЦЕССОМ с BASE_REF на базовый коммит — то есть ровно
 * так, как его гоняет CI.
 *
 * ★ Каждое поведение пинится ОТДЕЛЬНОЙ фикстурой, потому что зелёный тест
 * ничего не значит, пока не увидел его красным. Первая редакция гарда читала
 * HEAD через `git show :<path>` — индекс, а не рабочее дерево — и молча
 * печатала «изменений нет» на любой незастейдженной правке; в CI (где всё
 * закоммичено) она выглядела бы полностью исправной. Поймано мутацией
 * `.checkbox gap: 9px → 17px`, прошедшей насквозь. Отсюда тест
 * `рабочее дерево, а не индекс`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-css-semantics.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {}, commitHead = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2p-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  if (commitHead) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  }
  return { dir, baseRef };
}

function run({ dir, baseRef }, { ref, args = [] } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ───────────────────────── базовое поведение ───────────────────────── */

test('ничего не менялось — зелёный и НАЗЫВАЕТ это, а не молчит', (t) => {
  const css = '.btn { padding: 8px; }\n';
  const f = fixture(t, { base: { 'src/a.css': css }, head: {} });
  const { code, out } = run(f);
  assert.equal(code, 0);
  assert.match(out, /не изменились/);
});

test('изменение значения — красный, с классом и свойством в строке', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.checkbox gap: 9px → 17px/);
});

test('★ перенос правила между файлами при том же значении — ЗЕЛЁНЫЙ', (t) => {
  // Это главный инвариант: фазы 04–09 переносят правила в общие классы. Гард,
  // красный на каждом правильном ходе, будет выключен — и тогда он не поймает
  // ничего вообще.
  const f = fixture(t, {
    base: { 'src/design/app.css': '.trunc { overflow: hidden; }\n', 'src/b.css': '' },
    head: { 'src/design/app.css': '', 'src/b.css': '.trunc { overflow: hidden; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('удаление правила — красный (минус тоже изменение)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.card { border-radius: 20px; }\n' },
    head: { 'src/a.css': '' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.card border-radius/);
});

/* ─────────────────── ключ: состояние и media отдельно ─────────────────── */

test('★ :hover не вытесняет базовое значение — состояние это часть ключа', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.btn { gap: 9px; }\n' },
    head: { 'src/a.css': '.btn { gap: 9px; }\n.btn:hover { gap: 99px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.btn:hover gap/);
  // База не тронута: про `.btn gap` без состояния строки быть не должно.
  assert.doesNotMatch(out, /\n\s+\.btn gap/);
});

test('★ @media — отдельный контекст, мобильное значение не схлопывается с базой', (t) => {
  // ★ Меняется ДЕСКТОПНОЕ значение, а мобильное правило стоит НИЖЕ в файле и
  // при той же специфичности перекрыло бы его. Если media выкинуть из ключа,
  // победителем с обеих сторон окажется 4px, правка 8px→10px станет НЕВИДИМОЙ
  // и гард напечатает «чисто». Прежняя редакция этого теста меняла мобильное
  // значение и оставалась зелёной при выкинутом media — то есть пиннила не то.
  const f = fixture(t, {
    base: { 'src/a.css': '.x { padding: 8px; }\n@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: { 'src/a.css': '.x { padding: 10px; }\n@media (max-width: 640px) { .x { padding: 4px; } }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /padding: 8px → 10px/);
});

/* ──────────────────────────── каскад и вес ──────────────────────────── */

test('!important побеждает более специфичный селектор', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a.b { color: red; }\n.a { color: blue !important; }\n' },
    head: { 'src/a.css': '.a.b { color: red; }\n.a { color: green !important; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /color: blue → green/);
});

/* ───────────────────── «нечего проверять» ≠ «чисто» ───────────────────── */

test('недостижимая база — код 2, а не зелёный', (t) => {
  const f = fixture(t, { base: { 'src/a.css': '.x { gap: 1px; }\n' }, head: {} });
  const { code } = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(code, 2);
});

test('нераспознанный CSS — код 2, гард не печатает «чисто» по занижённому замеру', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.x { gap: 1px; }\n' },
    head: { 'src/a.css': '.x { gap: 1px;\n@media {{{\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
});

test('неизвестный флаг отвергается — обновлять потолок нечем', (t) => {
  const f = fixture(t, { base: { 'src/a.css': '.x { gap: 1px; }\n' }, head: {} });
  const { code, out } = run(f, { args: ['--write'] });
  assert.equal(code, 2);
  assert.match(out, /visual-diff-exempt/);
});

/* ──────────────────────────── escape-маркер ──────────────────────────── */

test('visual-diff-exempt в диффе пропускает намеренное изменение', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: ступень шкалы, апрув Pavel */\n.checkbox { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /объявлены намеренными/);
});

test('маркер на БАЗЕ не действует — исключение живёт ровно один PR', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '/* visual-diff-exempt: старое */\n.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: старое */\n.checkbox { gap: 12px; }\n' },
  });
  const { code } = run(f);
  assert.equal(code, 1);
});

/* ───────────────── рабочее дерево, а не индекс (та самая дыра) ───────────────── */

test('★ гард видит НЕЗАСТЕЙДЖЕННУЮ правку — читает рабочее дерево, не индекс', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n' },
    commitHead: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /gap: 9px → 17px/);
});
