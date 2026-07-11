/* Render ad templates to PNG.
   Usage: NODE_PATH=<dir with playwright-core> node render.mjs [id ...]
   Needs playwright-core + the preinstalled Chromium (/opt/pw-browsers). */
import { createRequire } from 'module';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(process.env.PW_REQUIRE_FROM || import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'out');

const SIZES = {
  g: [{ ratio: 'landscape', w: 1200, h: 628 }, { ratio: 'square', w: 1200, h: 1200 }],
  i: [{ ratio: 'portrait', w: 1080, h: 1350 }],
};
const LANGS = ['ru', 'en'];

const only = process.argv.slice(2);
const ids = readdirSync(ROOT).filter(f => /^[gi]\d\.html$/.test(f)).map(f => f.slice(0, 2))
  .filter(id => !only.length || only.includes(id)).sort();

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium']
  .concat(readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))
    .map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`))
  .find(p => existsSync(p));

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
for (const id of ids) {
  for (const { ratio, w, h } of SIZES[id[0]]) {
    for (const lang of LANGS) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`file://${join(ROOT, id + '.html')}?ratio=${ratio}&lang=${lang}`);
      await page.evaluate(() => document.fonts.ready);
      const name = `${id}_${ratio}_${lang}.png`;
      await page.locator('#stage').screenshot({ path: join(OUT, name) });
      console.log(name);
    }
  }
}
await browser.close();
