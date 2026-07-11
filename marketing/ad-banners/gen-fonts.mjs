/* Generates fonts.css (base64-embedded woff2 from public/fonts) so templates
   render standalone from file:// without a server. Run once before render.mjs:
   node gen-fonts.mjs */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FONTS = join(ROOT, '..', '..', 'public', 'fonts');

const face = (fam, w, file) => {
  const b64 = readFileSync(join(FONTS, file)).toString('base64');
  return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
};

let css = '';
for (const s of ['cyrillic', 'latin']) css += face('Exo 2', '700 800', `exo2/exo2-${s}.woff2`) + '\n';
for (const w of [400, 500, 600, 700]) for (const s of ['cyrillic', 'latin']) css += face('Golos Text', w, `golos/golos-text-${w}-${s}.woff2`) + '\n';
for (const w of [600, 700]) for (const s of ['cyrillic', 'latin']) css += face('JetBrains Mono', w, `jetbrains/jetbrains-mono-${w}-${s}.woff2`) + '\n';

writeFileSync(join(ROOT, 'fonts.css'), css);
console.log('fonts.css written');
