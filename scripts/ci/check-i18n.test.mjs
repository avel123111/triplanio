#!/usr/bin/env node
/**
 * Тесты гарда i18n (scripts/ci/check-i18n.mjs), проверка B — «новых
 * захардкоженных UI-строк нет».
 *
 * ПОЧЕМУ файл появился. Предикат B ищет текстовый узел JSX регуляркой
 * `>([^<>{}]+)<` по ДОБАВЛЕННЫМ строкам диффа. Стрелка `=>` даёт ему тот же
 * `>`, поэтому обычная стрелочная функция, возвращающая JSX через тернарник,
 * читалась как захардкоженный текст: живой PR получил
 * `hardcoded JSX text "(item.pending ?"` на строке, где строки нет вовсе.
 * Заглушить это `i18n-ignore` было бы враньём (маркер означает «строка
 * намеренно без t()»), поэтому предикат исправлен — а раз гард тронут, у него
 * появился тест (правило «CI-гард — это код»).
 *
 * Каждый тест собирает одноразовый git-репо, коммитит «базу», коммитит «голову»
 * и запускает гард подпроцессом с BASE_REF на базовый коммит — то есть ровно
 * так, как его запускает CI. Шаблон — check-inline-styles.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-i18n.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Репо с двумя коммитами: `base` — база PR, `head` — накат поверх неё. */
function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-i18n-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  // Глобальные gpgsign / hooksPath разработчика иначе сломали бы фикстуру, и
  // это выглядело бы как падение гарда.
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

function run({ dir, baseRef }) {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ── регресс, ради которого файл написан ─────────────────────────────────── */

test('стрелочная функция с тернарником — НЕ захардкоженный текст', (t) => {
  // Стрелка и первый тег обязаны быть на ОДНОЙ строке: гард разбирает дифф
  // построчно, и разнесённые по строкам они мимо предиката (поймано мутацией —
  // первая версия этого теста была зелёной и без исправления гарда).
  const f = fixture(t, {
    head: {
      'src/components/Rail.jsx':
        'const row = (item, i) => (item.pending ? <Skeleton key={i} /> : <Item key={i} />);\n' +
        'export const Rail = ({ items }) => items.map(row);\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `стрелка => не открывает текстовый узел:\n${r.out}`);
});

/* ── и при этом гард продолжает ловить то, ради чего он есть ─────────────── */

test('★ операторы сравнения — НЕ текстовый узел (`>=` … `<=` в обычном коде)', (t) => {
  // Второй случай того же класса, что стрелка: `>` от `>=` и `<` от `<=` дают
  // регулярке пару «скобок», между которыми лежит код. Живой PR получил
  // `hardcoded JSX text "= 2 && mod10"` на строке чистой арифметики.
  const f = fixture(t, {
    head: {
      'src/lib/plural.js':
        'export function form(n) {\n'
        + '  const mod10 = n % 10;\n'
        + '  if (mod10 >= 2 && mod10 <= 4) return "few";\n'
        + '  return "many";\n'
        + '}\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, `сравнение не открывает текстовый узел:\n${r.out}`);
  assert.ok(!/hardcoded JSX text/.test(r.out), r.out);
});

test('настоящий текст в JSX всё ещё ловится', (t) => {
  const f = fixture(t, { head: { 'src/components/A.jsx': 'export const A = () => <span>Привет, мир</span>;\n' } });
  const r = run(f);
  assert.equal(r.code, 1, 'кириллический текст в разметке обязан падать');
  assert.match(r.out, /Привет, мир/);
});

test('латиница со словами тоже ловится', (t) => {
  const f = fixture(t, { head: { 'src/components/A.jsx': 'export const A = () => <b>Save changes</b>;\n' } });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /Save changes/);
});

test('атрибут placeholder ловится', (t) => {
  const f = fixture(t, { head: { 'src/components/A.jsx': 'export const A = () => <input placeholder="Введите город" />;\n' } });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /placeholder/);
});

test('маркер i18n-ignore глушит СВОЮ строку', (t) => {
  const f = fixture(t, { head: { 'src/components/A.jsx': 'export const A = () => <b>Pro plan</b>; // i18n-ignore — имя тарифа\n' } });
  const r = run(f);
  assert.equal(r.code, 0, `маркер обязан гасить строку:\n${r.out}`);
});

// Дыра, найденная тем же заходом: pathspec `src/**/*.jsx` не матчит файл прямо
// в `src/` (`**` требует промежуточный каталог), поэтому App.jsx и main.jsx не
// проверялись вовсе.
test('★ файл ПРЯМО в src/ тоже проверяется (слепая зона pathspec)', (t) => {
  const f = fixture(t, { head: { 'src/App.jsx': 'export const A = () => <span>Забытая строка</span>;\n' } });
  const r = run(f);
  assert.equal(r.code, 1, `src/App.jsx обязан проверяться:\n${r.out}`);
  assert.match(r.out, /Забытая строка/);
});

// Содержимое нарочно выглядит как JSX-текст: иначе тест был бы зелёным и без
// фильтра по расширению, то есть не проверял бы ничего (поймано мутацией).
test('не-исходники в src/ проверку не трогают', (t) => {
  const f = fixture(t, { head: { 'src/README.md': 'Пример разметки: <b>Привет мир</b>\n' } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('код-подобный токен между тегами текстом не считается', (t) => {
  const f = fixture(t, { head: { 'src/components/A.jsx': 'export const A = () => <i>{x}</i>;\n' } });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});
