#!/usr/bin/env node
/**
 * Тесты CI-гарда 2b (`scripts/ci/check-destructive-migrations.mjs`).
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ (TRIP-524). Миграция сносила перегрузку функции
 * (`drop function ... search_gazetteer_batch(jsonb, text)`), автор по совести
 * поставил маркер `ddl-guard: allow-destructive` — а гард на неё НЕ РЕАГИРОВАЛ:
 * в списке паттернов были `DROP COLUMN`/`DROP TABLE`/`DROP NOT NULL`/`RENAME`/
 * `ALTER … DROP`, но не `DROP FUNCTION`. То есть маркер был декорацией, а снос
 * двери, выставленной наружу через PostgREST, проходил молча — он ломает фронт,
 * edge и тела других функций не ошибкой сборки, а 404 на RPC в рантайме.
 * Гард — код, и у него теперь есть тест: форма ровно та же, что у 2l
 * (временный git-репо, гард подпроцессом, ассерт кода выхода).
 *
 * ⚠️ Зелёный тест ничего не значит, пока не увиден КРАСНЫМ: каждая проверка
 * ниже прогонялась с вырезанным из гарда паттерном и падала.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-destructive-migrations.mjs', import.meta.url));
const DIR = 'supabase/migrations';

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Репо с двумя коммитами: `base` — база PR, `head` — то, что PR добавляет. */
function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2b-'));
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
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  return { dir, baseRef };
}

const run = ({ dir, baseRef }) => {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const MARKER = '-- ddl-guard: allow-destructive — TRIP-000, контрактная фаза\n';

test('★ DROP FUNCTION без маркера краснеет (дырка, найденная на TRIP-524)', (t) => {
  const r = run(fixture(t, { head: { [`${DIR}/20260101000000_x.sql`]: 'drop function if exists public.foo(jsonb, text);\n' } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /DROP FUNCTION/);
});

test('DROP FUNCTION с маркером проходит: снос перегрузки ради нового параметра — законная фаза', (t) => {
  const body = `${MARKER}drop function if exists public.foo(jsonb, text);\ncreate function public.foo(a jsonb, b text, c int default 1) returns void language sql as $$ select $$;\n`;
  const r = run(fixture(t, { head: { [`${DIR}/20260101000000_x.sql`]: body } }));
  assert.equal(r.code, 0);
  assert.match(r.out, /allowed \(marker present\)/);
});

test('соседние деструктивные формы по-прежнему краснеют (паттерн не съел их)', (t) => {
  for (const sql of ['alter table t drop column c;', 'drop table t;', 'alter table t rename to u;']) {
    const r = run(fixture(t, { head: { [`${DIR}/20260101000000_x.sql`]: `${sql}\n` } }));
    assert.equal(r.code, 1, sql);
  }
});

test('создание функции и обычный DDL не краснеют (гард не ловит всё подряд)', (t) => {
  const body = 'create or replace function public.foo() returns int language sql as $$ select 1 $$;\ncreate index idx on t (a);\n';
  const r = run(fixture(t, { head: { [`${DIR}/20260101000000_x.sql`]: body } }));
  assert.equal(r.code, 0);
});

test('★ судятся только ДОБАВЛЕННЫЕ строки: DROP FUNCTION, лежавший на базе, не краснеет', (t) => {
  // Иначе гард ронял бы любой PR, который трогает файл со старой миграцией, —
  // и его отключили бы, а не починили.
  const old = { [`${DIR}/20250101000000_old.sql`]: 'drop function if exists public.legacy();\n' };
  const r = run(fixture(t, { base: old, head: { [`${DIR}/20260101000000_new.sql`]: 'create index idx on t (a);\n' } }));
  assert.equal(r.code, 0);
});
