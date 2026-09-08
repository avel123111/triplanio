/**
 * Дрейф-гард реестра иллюстраций (TRIP-532).
 *
 * Три инварианта, каждый из которых ломается МОЛЧА (пустая плитка, прыжок
 * вёрстки), а не падением:
 *   1. у каждой записи реестра есть файл в `public/` по её `src`;
 *   2. `w`/`h` записи равны фактическому размеру файла из заголовка WebP —
 *      иначе `<img width height>` резервирует не ту коробку;
 *   3. каждый литерал ИМЕНИ картины в `src/**` есть в реестре — опечатка сегодня
 *      рендерит `null` без единого предупреждения.
 *
 * ⚠️ ФОРМ ИМЕНИ ТРИ, И СВЕРКА ОБЯЗАНА ВИДЕТЬ ВСЕ. Первая редакция читала только
 * `<Illustration name="…">` — то есть ПРЯМОЙ вызов примитива. Но имя приезжает к
 * нему и через владельца: `<ChoiceCard art="create-ai">`, `<EmptyState art=…>`
 * рисуют `<Illustration name={art} />`, а словарь видов точки
 * (`cities/CityAdder`) объявляет картину строкой поля (`art: 'point-start'`).
 * У всех трёх цена опечатки одна — пустое место без предупреждения, — а видел
 * гард одну. Поэтому единица сверки не «вызов примитива», а ЛИТЕРАЛ ИМЕНИ.
 *
 * Разметка читается ТЕКСТОМ (не import): `node --test` не парсит JSX-модули ДС
 * (приём из Cover.test.js / Layout.test.js). Реестр — чистый JS, его берём
 * импортом.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ILLUSTRATIONS } from './illustrations.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const SRC = join(ROOT, 'src');

/** Размер холста из заголовка WebP: VP8X (расширенный, с альфой), VP8L (lossless), VP8 (lossy). */
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

/** Файлы разметки `src/**`: сами тесты (включая этот) разметкой не считаются. */
function jsFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

test('★ Illustration: у каждой записи реестра есть файл, и его размер равен w/h записи', () => {
  for (const [name, pic] of Object.entries(ILLUSTRATIONS)) {
    assert.match(pic.src, /^\/images\/[a-z0-9-]+\.webp$/, `${name}: путь вне /images/ или не WebP`);
    const file = join(PUBLIC, pic.src);
    assert.ok(existsSync(file), `${name}: нет файла ${pic.src}`);
    assert.deepEqual(webpSize(file), { w: pic.w, h: pic.h }, `${name}: w/h в реестре ≠ размеру файла`);
  }
});

/** Три формы, которыми имя картины называют в коде (разбор — в шапке файла). */
const NAME_LITERALS = [
  /<Illustration\b[^>]*\bname="([^"]+)"/g, // прямой вызов примитива
  /\bart="([^"]+)"/g,                       // проп владельца: ChoiceCard, EmptyState
  /\bart:\s*'([^']+)'/g,                    // поле словаря: POINT_TYPES
];

test('★ Illustration: каждый литерал имени картины в src/** есть в реестре', () => {
  const missing = [];
  for (const file of jsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const re of NAME_LITERALS) {
      for (const m of text.matchAll(re)) {
        if (!ILLUSTRATIONS[m[1]]) missing.push(`${file.slice(ROOT.length)}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'имена вне реестра');
});
