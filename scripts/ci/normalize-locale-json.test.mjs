#!/usr/bin/env node
/**
 * Тесты нормализатора локалей (scripts/ci/normalize-locale-json.mjs).
 *
 * ЗАЧЕМ. Нормализатор — единственный код на пути «Tolgee → репозиторий»: он решает,
 * как выглядят байты, которые лягут в дифф PR синка. Если он тихо переставит,
 * склеит или потеряет значение, это уедет в прод как «перевод», и заметить будет
 * нечем: дифф покажет ровно то, что записал нормализатор. Поэтому у него есть тест
 * (CLAUDE.md: «A CI guard is code: it gets a test»).
 *
 * Ключевой инвариант, который тут закреплён: нормализатор — ЧИСТЫЙ ФОРМАТТЕР.
 * Он меняет ПОРЯДОК КЛЮЧЕЙ и РАСКЛАДКУ, и не имеет права трогать ни одно ЗНАЧЕНИЕ,
 * не имеет права терять ключи и не имеет права молча проглотить битый ввод.
 *
 * ★ Каждый зелёный проверен красным (TRIP-282): в конце файла перечислены мутации
 * и кейс, который каждая из них ОБЯЗАНА уронить. Зелёный тест, который не видели
 * красным, ничего не доказывает.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeJsonText, normalizeLocaleDir } from './normalize-locale-json.mjs';

// ── normalizeJsonText: порядок и раскладка ──────────────────────────────────

test('ключи верхнего уровня сортируются', () => {
  const out = normalizeJsonText('{"b":"2","A":"0","a":"1"}');
  assert.deepEqual(Object.keys(JSON.parse(out)), ['A', 'a', 'b']);
});

test('вложенные объекты сортируются рекурсивно', () => {
  const out = JSON.parse(normalizeJsonText('{"z":{"y":"1","x":"2"},"a":"3"}'));
  assert.deepEqual(Object.keys(out), ['a', 'z']);
  assert.deepEqual(Object.keys(out.z), ['x', 'y']);
});

test('массивы НЕ сортируются — порядок элементов есть часть данных', () => {
  const out = JSON.parse(normalizeJsonText('{"k":["b","a","c"]}'));
  assert.deepEqual(out.k, ['b', 'a', 'c']);
});

test('раскладка канонична: отступ 2 пробела и перевод строки в конце', () => {
  const out = normalizeJsonText('{"a":{"b":"c"}}');
  assert.equal(out, '{\n  "a": {\n    "b": "c"\n  }\n}\n');
});

test('нормализация идемпотентна — второй прогон не даёт диффа', () => {
  const once = normalizeJsonText('{"b":"2","a":{"d":"4","c":"3"}}');
  assert.equal(normalizeJsonText(once), once);
});

// ── normalizeJsonText: значения неприкосновенны ─────────────────────────────

test('значения не меняются: юникод, плейсхолдеры, пустая строка, спецсимволы', () => {
  const src = {
    ru: 'Начать с ИИ',
    ph: 'Осталось {count} дней до {city}',
    empty: '',
    esc: 'кавычка " и слеш \\ и перевод\nстроки',
    nested: { deep: '¡Empezar con IA!' },
  };
  assert.deepEqual(JSON.parse(normalizeJsonText(JSON.stringify(src))), src);
});

test('значение, похожее на ключ, не участвует в сортировке', () => {
  // Значение "a" у ключа "z" не должно утащить ключ вперёд.
  const out = JSON.parse(normalizeJsonText('{"z":"a","a":"z"}'));
  assert.deepEqual(Object.entries(out), [['a', 'z'], ['z', 'a']]);
});

test('ни один ключ не теряется', () => {
  const src = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, `v${i}`]));
  assert.deepEqual(JSON.parse(normalizeJsonText(JSON.stringify(src))), src);
});

test('битый JSON бросает, а не портит файл молча', () => {
  assert.throws(() => normalizeJsonText('{"a": }'));
});

// ── normalizeLocaleDir: обход дерева ────────────────────────────────────────

function withLocaleDir(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'loc-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const [lang, file] = rel.split('/');
      mkdirSync(join(root, lang), { recursive: true });
      writeFileSync(join(root, lang, file), text);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('переписывает только реально изменившиеся файлы и возвращает именно их', () => {
  withLocaleDir({
    'en/trips.json': '{"b":"2","a":"1"}',            // не нормализован → в списке
    'ru/trips.json': '{\n  "a": "1"\n}\n',           // уже канонический → не в списке
  }, (root) => {
    const changed = normalizeLocaleDir(root);
    assert.deepEqual(changed, ['en/trips.json']);
    assert.equal(readFileSync(join(root, 'en/trips.json'), 'utf8'), '{\n  "a": "1",\n  "b": "2"\n}\n');
    assert.equal(readFileSync(join(root, 'ru/trips.json'), 'utf8'), '{\n  "a": "1"\n}\n');
  });
});

test('не-JSON файлы не трогает', () => {
  withLocaleDir({ 'en/README.md': '# not json\n' }, (root) => {
    assert.deepEqual(normalizeLocaleDir(root), []);
    assert.equal(readFileSync(join(root, 'en/README.md'), 'utf8'), '# not json\n');
  });
});

/**
 * ★ МУТАЦИИ, ПРОВЕРЕННЫЕ КРАСНЫМ (каждая обязана уронить свой кейс):
 *
 *  1. `Object.keys(value).sort()` → `Object.keys(value)`
 *     роняет 4: «ключи верхнего уровня», «вложенные рекурсивно», «значение, похожее
 *     на ключ», «переписывает только изменившиеся».
 *  2. убрать ветку `Array.isArray(value)` (массив уходит в сортировку объекта)
 *     роняет 1: «массивы НЕ сортируются».
 *  3. `JSON.stringify(..., null, 2)` → `JSON.stringify(...)` (без отступа)
 *     роняет 2: «раскладка канонична», «переписывает только изменившиеся».
 *  4. убрать `\n` в конце шаблонной строки
 *     роняет 2: «раскладка канонична», «переписывает только изменившиеся».
 *  5. `if (after !== before)` → безусловная запись + push
 *     роняет 1: «переписывает только изменившиеся» (ru попадает в список).
 *  6. `file.endsWith('.json')` → `true`
 *     роняет 1: «не-JSON файлы не трогает».
 *
 * ГРАНИЦА, закреплённая явно: мутации раскладки (3, 4) НЕ роняют «не-JSON файлы не
 * трогает» — этот кейс про обход дерева, а не про байты, и так и задумано.
 */
