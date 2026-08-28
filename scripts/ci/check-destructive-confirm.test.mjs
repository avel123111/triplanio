#!/usr/bin/env node
/**
 * Тесты гарда 2af (scripts/ci/check-destructive-confirm.mjs).
 *
 * ЗАЧЕМ. Гард судит НЕ по виду кнопки, а по тому, ПИШЕТ ли её обработчик, —
 * значит вся его ценность в разборе тела обработчика, а разбор ошибается тихо.
 * Так и вышло на первой редакции: тело резалось «до следующего объявления того
 * же уровня», и у настоящего обработчика оно обрывалось на первой вложенной
 * строке `const …` — ДО шва записи. Гард считал нарушителя чистым и был зелёным.
 * Поймала это не проверка, а протухшая запись ALLOW. Поэтому тело функции здесь
 * закреплено отдельным случаем: вложенные объявления не должны прятать запись.
 *
 * Каждый случай — временное дерево `src/` и прогон гарда подпроцессом с этим
 * деревом как cwd, то есть ровно так, как его гоняет CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-destructive-confirm.mjs', import.meta.url));

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dc-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('краснеет: danger-кнопка пишет напрямую, без подтверждения', () => {
  const r = run({
    'src/Screen.jsx': `
      export function Screen() {
        const kill = async () => { await invokeFn('thing/delete', { body: {} }); };
        return <Btn variant="danger" onClick={kill}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /обработчик kill/);
});

test('★ вложенные объявления НЕ прячут запись (регресс первой редакции)', () => {
  // Именно на этой форме разбор ошибался: `const prev = …` обрывал тело до invokeFn.
  const r = run({
    'src/Screen.jsx': `
      export function Screen() {
        const kill = async () => {
          const prev = value;
          const next = other;
          await invokeFn('thing/delete', { body: {} });
        };
        return <Btn variant="danger" onClick={kill}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 1, r.out);
});

test('зелено: та же запись, но через канон-confirm', () => {
  const r = run({
    'src/Screen.jsx': `
      export function Screen() {
        const kill = () => confirm({
          title: 'Удалить?', description: 'Необратимо', variant: 'destructive',
          onConfirm: () => mut.mutateAsync({ id }),
        });
        return <Btn variant="danger" onClick={kill}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 0, r.out);
});

test('зелено: инлайновая стрелка с confirm', () => {
  const r = run({
    'src/Screen.jsx': `
      export function Screen() {
        return <Btn variant="danger-solid" onClick={() => confirm({ onConfirm: () => m.mutateAsync() })}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 0, r.out);
});

test('зелено: удаление из НЕСОХРАНЁННОЙ формы — шва записи нет', () => {
  const r = run({
    'src/Field.jsx': `
      export function Field() {
        const removeAt = (i) => { const next = docs.slice(); next.splice(i, 1); onChange(next); };
        return <IconBtn tone="danger" onClick={() => removeAt(0)} />;
      }`,
  });
  assert.equal(r.code, 0, r.out);
});

test('зелено и намеренно: обработчик пришёл пропом — судит вызыватель', () => {
  const r = run({
    'src/Panel.jsx': `
      export function Panel({ onRemove }) {
        return <Btn variant="danger" onClick={onRemove}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 0, r.out);
});

test('зелено: у кнопки нет обработчика (disabled-заглушка)', () => {
  const r = run({ 'src/Screen.jsx': '<Btn variant="danger" disabled>Удалить</Btn>' });
  assert.equal(r.code, 0, r.out);
});

test('краснеет: .mutate( тоже шов записи, не только invokeFn', () => {
  const r = run({
    'src/Screen.jsx': `
      export function Screen() {
        const drop = () => { delMut.mutate({ id: 1 }); };
        return <Btn variant="danger" icon="trash" onClick={drop}>Удалить</Btn>;
      }`,
  });
  assert.equal(r.code, 1, r.out);
});
