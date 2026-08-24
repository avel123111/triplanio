#!/usr/bin/env node
/**
 * Генератор встраиваемых ассетов share-карточки (TRIP-443).
 *
 * Edge-функция render-share-card НЕ читает файлы с диска в рантайме (eszip
 * шлёт граф модулей, не произвольные файлы), поэтому шрифты и лого встраиваются
 * base64 прямо в модуль. Этот скрипт воспроизводимо собирает assets_b64.ts из
 * исходников в public/ — руками файл не править, гонять `node scripts/gen-share-card-assets.mjs`.
 *
 * Состав FONT_B64 (порядок фиксирован, читается fontFaces.ts):
 *   0 Caveat cyrillic (ttf)   — «My trip!», «Scan to explore» (переносим as-is)
 *   1 Caveat latin (ttf)
 *   2 Geologica cyrillic (woff2, вариативный 400..800)
 *   3 Geologica cyrillic-ext (woff2)
 *   4 Geologica latin (woff2)
 *   5 Geologica latin-ext (woff2)
 * Montserrat/Rubik и фоновый jpeg (BG_DEFAULT_B64) выпилены: новый дизайн —
 * прозрачный стикер на Geologica, фон приходит подложкой с фронта.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = resolve(root, 'supabase/functions/render-share-card/assets_b64.ts');
const FONT_DIR = resolve(root, 'public/fonts/geologica');
const LOGO = resolve(root, 'public/triplanio-logo.svg');

// Существующие байты Caveat (ttf) из текущего assets_b64 — переносим без изменений.
const cur = readFileSync(OUT, 'utf8');
const m = cur.match(/FONT_B64[^[]*\[([\s\S]*?)\];/);
if (!m) throw new Error('не нашёл FONT_B64 в текущем assets_b64.ts');
const oldFonts = m[1].match(/"[^"]*"/g).map((x) => x.slice(1, -1));
const caveatCyr = oldFonts[0];
const caveatLat = oldFonts[1];

const b64 = (p) => readFileSync(p).toString('base64');
const geoCyr = b64(resolve(FONT_DIR, 'geologica-cyrillic.woff2'));
const geoCyrExt = b64(resolve(FONT_DIR, 'geologica-cyrillic-ext.woff2'));
const geoLat = b64(resolve(FONT_DIR, 'geologica-latin.woff2'));
const geoLatExt = b64(resolve(FONT_DIR, 'geologica-latin-ext.woff2'));
const logoB64 = b64(LOGO);

const fonts = [caveatCyr, caveatLat, geoCyr, geoCyrExt, geoLat, geoLatExt];

const out = `// AUTO-GENERATED (TRIP-443) — base64-встроенные ассеты share-карточки.
// Встроены (не с диска, не с CDN), потому что Supabase edge НЕ отдаёт бандлённые
// файлы через Deno.readFile(import.meta.url): eszip шлёт граф модулей, не файлы.
// Воспроизводимо: scripts/gen-share-card-assets.mjs. РУКАМИ НЕ ПРАВИТЬ.
//
// FONT_B64 (порядок читает fontFaces.ts):
//   0 Caveat cyrillic (ttf)      3 Geologica cyrillic-ext (woff2)
//   1 Caveat latin (ttf)         4 Geologica latin (woff2)
//   2 Geologica cyrillic (woff2) 5 Geologica latin-ext (woff2)
// Geologica — вариативный woff2 (одна ось веса 400..800 на сабсет).
export const FONT_B64: string[] = [
${fonts.map((f) => `  "${f}",`).join('\n')}
];

// Логотип Triplanio (public/triplanio-logo.svg) для футера карточки — base64 SVG.
export const LOGO_SVG_B64 = "${logoB64}";
`;

writeFileSync(OUT, out);
console.log('wrote', OUT);
console.log('font entries:', fonts.map((f) => f.length));
console.log('logo b64 len:', logoB64.length);
