#!/usr/bin/env node
/**
 * Тесты CI guard 2y (scripts/ci/check-spec-columns.mjs) — TRIP-420.
 *
 * Как у 2t/3b: каждый кейс строит одноразовые фикстуры (типы схемы + файлы
 * ресурсов во временном каталоге), гоняет гард подпроцессом с путями через env
 * и проверяет КОД ВЫХОДА. Зелёный тест ничего не значит, пока не увиден красным —
 * каждый «bad»-кейс это мутация, которую гард обязан ловить (0 сошлось · 1 лишнее
 * поле/неизвестная таблица · 2 не смог измерить).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-spec-columns.mjs', import.meta.url));

/** database.types.ts-подобный текст из { table: [колонки] }. */
function typesFile(tables) {
  let s = 'export type Database = {\n  public: {\n    Tables: {\n';
  for (const [t, cols] of Object.entries(tables)) {
    s += `      ${t}: {\n        Row: {\n`;
    for (const c of cols) s += `          ${c}: string | null\n`;
    s += '        }\n      }\n';
  }
  s += '    }\n  }\n}\n';
  return s;
}

function fixture(t, { tables, resources }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2y-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const typesPath = join(dir, 'database.types.ts');
  writeFileSync(typesPath, typesFile(tables));
  const resDir = join(dir, 'resources');
  mkdirSync(resDir, { recursive: true });
  for (const [name, body] of Object.entries(resources)) {
    const full = join(resDir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return { typesPath, resDir };
}

function run({ typesPath, resDir }) {
  const r = spawnSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, SPEC_COLUMNS_TYPES: typesPath, SPEC_COLUMNS_RESOURCES: resDir },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const spec = (actions) => `import type { ResourceSpec } from '../mutateRules.ts';
export const X: ResourceSpec = {
  name: 'x',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
${actions}
  },
};
`;

const COLS = { activities: ['id', 'trip_id', 'created_by', 'title', 'currency'] };

/* ─────────────────────────────── зелёная база ───────────────────────────── */

test('поля ⊆ колонок → OK', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    thing: {
      op: 'upsert',
      table: 'activities',
      requires: ['editor'],
      fields: { title: { type: 'string' }, currency: { type: 'string' } },
      forcedOnInsert: { created_by: '@actor' },
    },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

/* ─────────────────────────────── мутации (red) ──────────────────────────── */

test('лишнее поле не колонка → fail', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    thing: {
      op: 'upsert',
      table: 'activities',
      requires: ['editor'],
      fields: { title: { type: 'string' }, booking_url: { type: 'string', max: 2048 } },
    },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /booking_url/);
});

test('лишнее поле приезжает СПРЕДОМ (резолв фрагмента) → fail', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': `import type { ResourceSpec, FieldSpec } from '../mutateRules.ts';
const META: Record<string, FieldSpec> = {
  booking_reference: { type: 'string', max: 300, nullable: true },
  booking_url: { type: 'string', max: 2048, nullable: true },
};
export const X: ResourceSpec = {
  name: 'x',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    thing: {
      op: 'upsert',
      table: 'activities',
      requires: ['editor'],
      fields: { ...META, title: { type: 'string' } },
    },
  },
};
`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /booking_reference, booking_url/);
});

test('спред резолвится ЧЕРЕЗ АЛИАС из другого файла → fail', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'frag.ts': `import type { FieldSpec } from '../mutateRules.ts';
export const BASE: Record<string, FieldSpec> = { ghost: { type: 'string' } };
`,
      'x.ts': `import type { ResourceSpec } from '../mutateRules.ts';
import { BASE } from './frag.ts';
const ALIAS = BASE;
export const X: ResourceSpec = {
  name: 'x',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    thing: { op: 'insert', table: 'activities', requires: ['editor'], fields: { ...ALIAS, title: { type: 'string' } } },
  },
};
`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ghost/);
});

test('forcedOnInsert-ключ не колонка → fail', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    thing: {
      op: 'insert',
      table: 'activities',
      requires: ['editor'],
      fields: { title: { type: 'string' } },
      forcedOnInsert: { created_by: '@actor', bogus_col: 'x' },
    },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /bogus_col/);
});

test('неизвестная таблица → fail', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    thing: {
      op: 'upsert',
      table: 'activites',
      requires: ['editor'],
      fields: { title: { type: 'string' } },
    },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /не найдена/);
});

/* ─────────────────── пропуски по построению (должны быть OK) ─────────────── */

test("op:'rpc' с не-колонками (аргументы RPC) → пропуск, OK", (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      // Чтобы датчик слепоты не сработал, рядом есть валидное DML-действие.
      'x.ts': spec(`    dml: { op: 'delete', table: 'activities', requires: ['editor'] },
    tx: {
      op: 'rpc',
      rpc: 'do_thing',
      requires: ['editor'],
      fields: { p_from: { type: 'uuid' }, waypoints: { type: 'array' } },
    },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('delete без полей + строковый ключ действия → OK', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    'thing/delete': { op: 'delete', table: 'activities', requires: ['editor'], loadTarget: true },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

/* ─────────────────────────── датчик слепоты (код 2) ──────────────────────── */

test('ноль таблиц в типах → код 2 (не смог измерить)', (t) => {
  const f = fixture(t, {
    tables: {},
    resources: {
      'x.ts': spec(`    thing: { op: 'upsert', table: 'activities', requires: ['editor'], fields: { title: { type: 'string' } } },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
});

test('ноль table-DML-действий (только rpc) → код 2', (t) => {
  const f = fixture(t, {
    tables: COLS,
    resources: {
      'x.ts': spec(`    tx: { op: 'rpc', rpc: 'do_thing', requires: ['editor'], fields: { p_x: { type: 'uuid' } } },`),
    },
  });
  const r = run(f);
  assert.equal(r.code, 2, r.out);
});
