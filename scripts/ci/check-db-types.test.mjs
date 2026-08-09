#!/usr/bin/env node
/**
 * Тесты CI-гарда 2t (scripts/ci/check-db-types.mjs).
 *
 * Форма — шаблон `check-inline-styles.test.mjs` (TRIP-282): запустить гард
 * ПОДПРОЦЕССОМ и проверить код выхода. Git-репо тут не нужен — 2t не ходит к
 * базовой ветке, он сверяет два ТЕКСТА, и именно поэтому судящая половина
 * отделена от производящей: Docker и живая база остаются в джобе, а всё, что
 * решает вердикт, проверяется фикстурами.
 *
 * Три вердикта разведены намеренно и проверяются ОТДЕЛЬНО:
 *   0 — совпало · 1 — дрейф · 2 — не смог измерить.
 * Пара «пустая база с обеих сторон» стоит здесь как отдельный тест: без
 * датчика слепоты она зелена ПО ПОСТРОЕНИЮ, то есть гард печатал бы OK над
 * пустой комнатой.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-db-types.mjs', import.meta.url));
const REPO_TYPES = fileURLToPath(
  new URL('../../supabase/functions/_shared/database.types.ts', import.meta.url),
);

/** Правдоподобный кусок вывода `supabase gen types typescript`. */
const types = ({ pgrst = '14.5', extraColumn = '', tables = ['trips', 'city_visits'] } = {}) =>
  `export type Json = string | number | boolean | null

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "${pgrst}"
  }
  public: {
    Tables: {
${tables
  .map(
    (t) => `      ${t}: {
        Row: {
          id: string
          title: string | null${extraColumn ? `\n          ${extraColumn}` : ''}
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
      }`,
  )
  .join('\n')}
    }
    Views: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}
`;

/** Тот же генератор на ПУСТОЙ базе: файл валиден, таблиц ноль. */
const emptyTypes = () => `export type Json = string | number | boolean | null

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: { [_ in never]: never }
    Views: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}
`;

/** Кладёт стороны во временный каталог и возвращает код выхода + вывод. */
function run(t, { generated, committed, args } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2t-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const genPath = join(dir, 'generated.types.ts');
  const comPath = join(dir, 'committed.types.ts');
  if (generated !== undefined) writeFileSync(genPath, generated);
  if (committed !== undefined) writeFileSync(comPath, committed);

  const r = spawnSync(process.execPath, [GUARD, ...(args ?? [genPath])], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, COMMITTED_TYPES: comPath },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('совпало → 0', (t) => {
  const { code } = run(t, { generated: types(), committed: types() });
  assert.equal(code, 0);
});

test('миграция добавила колонку, типы не перегенерили → 1', (t) => {
  const { code, out } = run(t, {
    generated: types({ extraColumn: 'cover_image_url: string | null' }),
    committed: types(),
  });
  assert.equal(code, 1);
  assert.match(out, /cover_image_url/);
});

test('в закоммиченных есть колонка, которой в миграциях нет → 1', (t) => {
  const { code } = run(t, {
    generated: types(),
    committed: types({ extraColumn: 'dropped_column: string | null' }),
  });
  assert.equal(code, 1);
});

test('миграция добавила таблицу → 1', (t) => {
  const { code, out } = run(t, {
    generated: types({ tables: ['trips', 'city_visits', 'trip_documents'] }),
    committed: types(),
  });
  assert.equal(code, 1);
  assert.match(out, /trip_documents/);
});

test('разные только CRLF и хвостовые пробелы → 0', (t) => {
  const { code } = run(t, {
    generated: types().replace(/\n/g, '\r\n'),
    committed: `${types().replace(/\n/g, '   \n')}\n\n`,
  });
  assert.equal(code, 0);
});

test('ИСКЛЮЧЕНИЙ НЕТ: расходится только служебный блок генератора → 1', (t) => {
  // Первая редакция гасила тут `__InternalSupabase.PostgrestVersion` — и это
  // прятало настоящую причину («артефакт собран ДРУГИМ генератором»). Обе
  // стороны теперь делает один пинованный CLI, поэтому расхождение красное.
  const { code } = run(t, {
    generated: types({ pgrst: '12.2' }),
    committed: types({ pgrst: '14.5' }),
  });
  assert.equal(code, 1);
});

test('ИСКЛЮЧЕНИЙ НЕТ: блока генератора нет на одной стороне → 1', (t) => {
  const { code } = run(t, {
    generated: types().replace(/ {2}__InternalSupabase: \{\n.*\n {2}\}\n/, ''),
    committed: types(),
  });
  assert.equal(code, 1);
});

test('литерал в типе колонки сверяется как всё остальное → 1', (t) => {
  // Типы колонок у генератора тоже приезжают литералами (`"draft" | "active"`) —
  // пинит, что нормализация не трогает значения в кавычках.
  const withLiteral = (v) => types().replace('title: string | null', `status: "${v}"`);
  const { code } = run(t, { generated: withLiteral('active'), committed: withLiteral('draft') });
  assert.equal(code, 1);
});

test('сгенерированного файла нет → 2 (не смог измерить, не «OK»)', (t) => {
  const { code, out } = run(t, { committed: types() });
  assert.equal(code, 2);
  assert.match(out, /не найден/);
});

test('закоммиченный артефакт удалён → 2', (t) => {
  const { code } = run(t, { generated: types() });
  assert.equal(code, 2);
});

test('путь к сгенерированному не передан → 2', (t) => {
  const { code, out } = run(t, { generated: types(), committed: types(), args: [] });
  assert.equal(code, 2);
  // Ассерт на СВОЁ сообщение, а не только на код: без него тест зелен и когда
  // ветки «не передан путь» нет вовсе — пустой путь падает дальше в «файл не
  // найден», и это тоже 2. Мутация «снять раннюю проверку» не роняла НИЧЕГО.
  assert.match(out, /не передан путь/);
});

test('файл есть, но не читается (каталог вместо файла) → 2, а не 1', (t) => {
  // `existsSync` говорит «да» и про каталог; непойманный `EISDIR` увёл бы node
  // на код 1 = «ДРЕЙФ», хотя не измерено ничего. Ветка 1 и ветка 2 не должны
  // разъезжаться нигде — вердикт «не смог измерить» обязан звучать как он сам.
  const dir = mkdtempSync(join(tmpdir(), 'guard2t-dir-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const asDir = join(dir, 'generated.types.ts');
  mkdirSync(asDir);
  const comPath = join(dir, 'committed.types.ts');
  writeFileSync(comPath, types());

  const r = spawnSync(process.execPath, [GUARD, asDir], {
    encoding: 'utf8',
    env: { ...process.env, COMMITTED_TYPES: comPath },
  });
  assert.equal(r.status, 2);
  assert.match(`${r.stdout}${r.stderr}`, /не прочитался/);
});

test('ДАТЧИК СЛЕПОТЫ: база не поднялась, таблиц ноль → 2, а не 1', (t) => {
  const { code, out } = run(t, { generated: emptyTypes(), committed: types() });
  assert.equal(code, 2);
  assert.match(out, /не похож на типы схемы/);
});

test('ДАТЧИК СЛЕПОТЫ: пусто с ОБЕИХ сторон → 2, а не зелёный над пустой комнатой', (t) => {
  const { code } = run(t, { generated: emptyTypes(), committed: emptyTypes() });
  assert.equal(code, 2);
});

test('сгенерированный файл — мусор (нет корня схемы) → 2', (t) => {
  const { code } = run(t, { generated: 'Error: connection refused\n', committed: types() });
  assert.equal(code, 2);
});

test('обрезанный файл: таблицы есть, корня схемы нет → 2', (t) => {
  // Датчик жизни — И-условие из ДВУХ клауз, а мусор выше отсекается ПЕРВОЙ же
  // (у него ноль таблиц), поэтому вторая клауза не была запинена ничем: мутация
  // «убрать проверку `export type Database`» оставляла все тесты зелёными.
  // Здесь таблицы НАСЧИТЫВАЮТСЯ, и вердикт держит ровно корень схемы.
  const truncated = types().replace('export type Database = {', 'куда-то делась шапка {');
  const { code, out } = run(t, { generated: truncated, committed: types() });
  assert.equal(code, 2);
  assert.match(out, /корень схемы отсутствует/);
});

test('живой артефакт репо проходит датчик жизни (сам с собой → 0)', (t) => {
  const r = spawnSync(process.execPath, [GUARD, REPO_TYPES], {
    encoding: 'utf8',
    env: { ...process.env, COMMITTED_TYPES: REPO_TYPES },
  });
  assert.equal(
    r.status,
    0,
    `гард не признал живой supabase/functions/_shared/database.types.ts типами:\n${r.stdout}${r.stderr}`,
  );
  // Не инертно: предикат жизни обязан НАСЧИТАТЬ таблицы в настоящем артефакте,
  // а не просто не упасть — при сломанной регулярке тут был бы код 2.
  assert.match(r.stdout, /сгенерировано (\d+) таблиц\/вью/);
  assert.ok(Number(r.stdout.match(/сгенерировано (\d+) таблиц/)[1]) > 30);
});
