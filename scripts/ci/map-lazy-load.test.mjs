/**
 * Карта не имеет права держать старт приложения (TRIP-445).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ. Свойство ломается ОДНОЙ обычной строкой
 * `import mapboxgl from 'mapbox-gl'`, написанной из лучших побуждений в любом
 * файле, который дотягивается до `MapProvider` (а он стоит выше роутера, то
 * есть до него дотягивается всё). Сломать можно молча: сборка зелёная, тесты
 * зелёные, экраны работают — просто лендинг снова 1.7 МБ и белый экран на 4G.
 * Замер, ради которого это делалось: с заблокированным куском лендинг не
 * рисовал НИЧЕГО (0 символов, FCP null); на 4G первый кадр был 6472 мс.
 *
 * Второе правило здесь — про токен. Он раньше приезжал побочным эффектом
 * импорта двери (`mapboxgl.accessToken = …`). Загружается библиотека теперь по
 * требованию, порядок не гарантирован, поэтому каждый, кто создаёт карту,
 * обязан назвать токен своей опцией. Забыть — значит получить карту, которая
 * работает ровно до тех пор, пока кто-то другой успел загрузиться раньше.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const DOOR = 'src/lib/mapbox.js';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(p)) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);
const read = (p) => readFileSync(p, 'utf8');

/**
 * Убрать комментарии, НЕ трогая строковые литералы. Без этого тест судил бы по
 * тексту комментариев: в `mapbox.js` фраза `new mapboxgl.Map({ config })` живёт
 * в пояснении и красила проверку токена. Литералы пропускаются честно, потому
 * что в стилях лежит `mapbox://…` — наивная резка по `//` съела бы строку.
 */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        if (i < src.length) { out += src[i]; i += 1; }
      }
      out += src[i] ?? '';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Статический импорт `mapbox-gl` (или его CSS) — то, чего быть не должно. */
const STATIC_IMPORT = /^\s*import\s[^\n]*?['"]mapbox-gl(\/[^'"]*)?['"]/m;

test('★★★ НИ ОДИН файл не импортирует mapbox-gl статически', () => {
  const guilty = FILES.filter((f) => STATIC_IMPORT.test(read(f)));
  assert.deepEqual(guilty, [],
    `статический импорт возвращает 1.7 МБ в стартовый граф: ${guilty.join(', ')}`);
});

test('дверь грузит библиотеку динамически и отдаёт признак готовности', () => {
  const door = read(DOOR);
  assert.match(door, /import\(\s*['"]mapbox-gl['"]\s*\)/, 'нет динамического import("mapbox-gl")');
  assert.match(door, /import\(\s*['"]mapbox-gl\/dist\/mapbox-gl\.css['"]\s*\)/,
    'CSS обязан ехать вместе с библиотекой — иначе он снова render-blocking в <head>');
  assert.match(door, /export function loadMapboxGl/);
  assert.match(door, /export const isMapboxGlLoaded/);
});

test('★★ каждая создаваемая карта называет токен СВОЕЙ опцией', () => {
  // Разбор по балансу скобок, а не грепом: `accessToken` мог бы найтись в
  // соседнем вызове и тест бы врал зелёным.
  const MARK = 'new mapboxgl.Map(';
  let checked = 0;
  for (const f of FILES) {
    const s = stripComments(read(f));
    let i = s.indexOf(MARK);
    while (i !== -1) {
      let depth = 0, j = i + MARK.length - 1;
      do {
        if (s[j] === '(' || s[j] === '{') depth += 1;
        else if (s[j] === ')' || s[j] === '}') depth -= 1;
        j += 1;
      } while (depth > 0 && j < s.length);
      const opts = s.slice(i, j);
      assert.ok(opts.includes('accessToken'),
        `${f}: new mapboxgl.Map без accessToken — карта работает только по наследству`);
      checked += 1;
      i = s.indexOf(MARK, j);
    }
  }
  // Ноль найденных мест = тест ничего не проверил и молчит. Сегодня их три:
  // MapProvider (общий синглтон), ShareMapPreview (калька), captureMap (снимок).
  assert.equal(checked, 3, `ожидалось 3 места создания карты, найдено ${checked}`);
});
