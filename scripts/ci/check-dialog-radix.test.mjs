#!/usr/bin/env node
/**
 * Tests for CI guard 2f (scripts/ci/check-dialog-radix.mjs).
 *
 * WHY (TRIP-321 · унификация шторок). Гард ЕСТЬ КОД, и до этого файла у 2f
 * теста не было — а вместе с ним не было и доказательства, что он вообще
 * краснеет. Второй инвариант («vaul только в шве») добавлен ровно затем, чтобы
 * пятая копия мобильной шторки была структурно непредставима, поэтому цена
 * молча-зелёного гарда здесь — возвращение того самого зоопарка.
 *
 * Гард 2f — не дифф, а самосогласованность дерева `src/`, поэтому фикстура
 * проще шаблона 2l: временная директория с несколькими файлами и запуск гарда
 * подпроцессом с `cwd` на неё (ROOT у гарда относительный).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-dialog-radix.mjs', import.meta.url));

/** Дерево `src/` во временной папке: { 'src/…/x.jsx': body }. */
function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2f-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });

// Файл-шов ровно там, где его ждёт VAUL_ALLOW.
const SEAM = 'src/components/ui/sheetShell.jsx';
const CLEAN = {
  'src/pages/Screen.jsx': "import { Sheet } from '@/components/ui/Sheet';\nexport const S = () => <Sheet />;\n",
};

test('чистое дерево проходит', (t) => {
  const r = run(fixture(t, CLEAN));
  assert.equal(r.status, 0, r.stderr);
});

test('сырой импорт Radix вне списка оболочек роняет PR', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    'src/pages/Rogue.jsx': "import * as Dialog from '@radix-ui/react-dialog';\nexport const R = () => <Dialog.Root />;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/pages\/Rogue\.jsx/);
});

test('тот же импорт ВНУТРИ оболочки из списка проходит', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    // Файл шва обязан РЕАЛЬНО ПРИМЕНЯТЬ границу краха (импорт + JSX-тег), TRIP-515.
    'src/components/ui/dialog.jsx': "import * as Dialog from '@radix-ui/react-dialog';\nimport { SurfaceCrashGuard } from '@/components/ui/surfaceCrashGuard';\nexport const D = (p) => <Dialog.Root><SurfaceCrashGuard open={p.open}>{p.children}</SurfaceCrashGuard></Dialog.Root>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('импорт vaul вне шва роняет PR (пятая копия шторки)', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    'src/components/stats/OwnSheet.jsx': "import { Drawer } from 'vaul';\nexport const O = () => <Drawer.Root />;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /OwnSheet\.jsx/);
  assert.match(r.stderr, /sheetShell/);
});

test('vaul в самом шве проходит', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    // Шов обязан РЕАЛЬНО ПРИМЕНЯТЬ границу краха (импорт + JSX-тег), TRIP-515.
    [SEAM]: "import { Drawer } from 'vaul';\nimport { SurfaceCrashGuard } from '@/components/ui/surfaceCrashGuard';\nexport const SheetRoot = (p) => <Drawer.Root><SurfaceCrashGuard open={p.open}>{p.children}</SurfaceCrashGuard></Drawer.Root>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

// TRIP-515: файл шва БЕЗ границы краха роняет PR. Без этого п.4 — no-op: краш в
// окне снова убивал бы приложение. Увидено красным — верните применение границы
// в фикстуру, и status станет 0.
test('шов без границы краха (SurfaceCrashGuard) роняет PR', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    [SEAM]: "import { Drawer } from 'vaul';\nexport const SheetRoot = Drawer.Root;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sheetShell\.jsx/);
  assert.match(r.stderr, /SurfaceCrashGuard/);
});

// ★ ПРОВЕРЯЕТСЯ ПРИМЕНЕНИЕ, А НЕ УПОМИНАНИЕ (ревью Pavel PR #1154). Прежний
// предикат был подстрокой имени и зеленел на файле, где границу СНЯЛИ, оставив
// комментарий `// SurfaceCrashGuard снят`. Здесь ровно этот случай — импорта и
// JSX-тега нет, только имя в комментарии — обязан ронять PR.
test('упоминание границы в КОММЕНТАРИИ без применения роняет PR', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    [SEAM]: "import { Drawer } from 'vaul';\n// SurfaceCrashGuard: временно снят, вернём позже\nexport const SheetRoot = Drawer.Root;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sheetShell\.jsx/);
});

test('<DialogContent> без <DialogTitle> роняет PR (безымянная модалка)', (t) => {
  const r = run(fixture(t, {
    ...CLEAN,
    'src/pages/Nameless.jsx': "import { DialogContent } from '@/design/index';\nexport const N = () => <DialogContent>x</DialogContent>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Nameless\.jsx/);
});
