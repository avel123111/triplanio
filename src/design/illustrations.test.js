/**
 * Дрейф-гард реестра иллюстраций (TRIP-532).
 *
 * Три инварианта, каждый из которых ломается МОЛЧА (пустая плитка, прыжок
 * вёрстки), а не падением:
 *   1. у каждой записи реестра есть файл в `public/` по её `src`;
 *   2. `w`/`h` записи равны фактическому размеру файла из заголовка WebP —
 *      иначе `<img width height>` резервирует не ту коробку;
 *   3. каждый литерал `<Illustration name="…"` в `src/**` есть в реестре —
 *      опечатка в имени сегодня рендерит `null` без единого предупреждения.
 *
 * Реестр и JSX читаются ТЕКСТОМ (не import): `node --test` не парсит JSX-модули
 * ДС (приём из Cover.test.js / Layout.test.js). Реестр — чистый JS, его можно
 * импортировать напрямую.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ILLUSTRATIONS } from './illustrations.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const SRC = join(ROOT, 'src');

/** Размер холста из заголовка WebP: VP8X (расширенный, с альфой) или VP8L (lossless). */
function webpSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 8, 12), 'WEBP', `${file}: не WebP`);
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  assert.fail(`${file}: неизвестный чанк WebP ${chunk}`);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) yield p; // тесты (этот файл) — не разметка
  }
}

test('★ Illustration: у каждой записи реестра есть файл, и его размер равен w/h записи', () => {
  for (const [name, it] of Object.entries(ILLUSTRATIONS)) {
    assert.match(it.src, /^\/images\/[a-z0-9-]+\.webp$/, `${name}: путь вне /images/ или не WebP`);
    const file = join(PUBLIC, it.src);
    assert.ok(statSync(file).isFile(), `${name}: нет файла ${it.src}`);
    assert.deepEqual(webpSize(file), { w: it.w, h: it.h }, `${name}: w/h в реестре ≠ размеру файла`);
  }
});

test('★ Illustration: каждый литерал name="…" в src/** есть в реестре', () => {
  const missing = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<Illustration\b[^>]*\bname="([^"]+)"/g)) {
      if (!ILLUSTRATIONS[m[1]]) missing.push(`${file.slice(ROOT.length)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'имена вне реестра');
});
