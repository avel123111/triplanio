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
 *   0 Geologica cyrillic (woff2, вариативный 400..800)
 *   1 Geologica cyrillic-ext (woff2)
 *   2 Geologica latin (woff2)
 *   3 Geologica latin-ext (woff2)
 * Caveat (рукописное «My trip!»/«Scan to explore»), Montserrat/Rubik и фоновый
 * jpeg выпилены: дизайн v34 — единственный шрифт Geologica, фон приходит
 * подложкой с фронта.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = resolve(root, 'supabase/functions/render-share-card/assets_b64.ts');
const FLAGS_OUT = resolve(root, 'supabase/functions/render-share-card/flags_b64.ts');
const FONT_DIR = resolve(root, 'public/fonts/geologica');
const FLAGS_DIR = resolve(root, 'public/flags');
const LOGO = resolve(root, 'public/triplanio-logo.svg');

const b64 = (p) => readFileSync(p).toString('base64');
const geoCyr = b64(resolve(FONT_DIR, 'geologica-cyrillic.woff2'));
const geoCyrExt = b64(resolve(FONT_DIR, 'geologica-cyrillic-ext.woff2'));
const geoLat = b64(resolve(FONT_DIR, 'geologica-latin.woff2'));
const geoLatExt = b64(resolve(FONT_DIR, 'geologica-latin-ext.woff2'));
const logoB64 = b64(LOGO);

const fonts = [geoCyr, geoCyrExt, geoLat, geoLatExt];

const out = `// AUTO-GENERATED (TRIP-443) — base64-встроенные ассеты share-карточки.
// Встроены (не с диска, не с CDN), потому что Supabase edge НЕ отдаёт бандлённые
// файлы через Deno.readFile(import.meta.url): eszip шлёт граф модулей, не файлы.
// Воспроизводимо: scripts/gen-share-card-assets.mjs. РУКАМИ НЕ ПРАВИТЬ.
//
// FONT_B64 (порядок читает fontFaces.ts):
//   0 Geologica cyrillic (woff2)     2 Geologica latin (woff2)
//   1 Geologica cyrillic-ext (woff2) 3 Geologica latin-ext (woff2)
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

// ---- флаги стран (ISO2) для ряда «Visited Countries» -----------------------
// Встроены на edge (а не инлайнятся клиентом): детерминированно, превью == финал,
// без хрупкого async-fetch /flags/*. Только 2-буквенные коды (страны), не субъекты
// (us-ak и т.п.). Флаг несёт свой круглый clip внутри — рисуем как есть в <image>.
const flagFiles = readdirSync(FLAGS_DIR).filter((f) => /^[a-z]{2}\.svg$/.test(f));
const flagEntries = flagFiles
  .map((f) => `  ${f.slice(0, 2)}: "${readFileSync(resolve(FLAGS_DIR, f)).toString('base64')}",`)
  .join('\n');
const flagsOut = `// AUTO-GENERATED (TRIP-443) — base64-встроенные SVG-флаги стран (ISO2) для ряда
// «Visited Countries» share-карточки. Воспроизводимо: scripts/gen-share-card-assets.mjs.
// РУКАМИ НЕ ПРАВИТЬ. Ключ = нижний регистр ISO2; значение = base64 SVG-флага.
export const FLAGS_B64: Record<string, string> = {
${flagEntries}
};
`;
writeFileSync(FLAGS_OUT, flagsOut);
console.log('wrote', FLAGS_OUT, '-', flagFiles.length, 'flags');
