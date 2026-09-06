// Приёмка выпечки: по каждому публичному адресу приезжает СВОЙ готовый файл.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ `scripts/build/prerender.test.mjs`. Тот проверяет
// ЧИСТУЮ ФУНКЦИЮ — правильно ли собран документ из шаблона и снимка; он живёт в
// обычном `npm test` и браузера не требует. Здесь проверяется ДРУГОЕ и
// непроверяемое юнит-тестом: что сборка действительно положила файлы, что по
// адресу приезжает именно свой, и что тот, кто НЕ выполняет JavaScript, видит
// текст. Ровно эта половина и была сломана: замер прода 05.09.2026 — ноль
// символов в теле для поискового робота ChatGPT при живом, полном лендинге.
//
// В CI НЕ ХОДИТ — как и `check:proto`: нужна собранная `dist` и chromium.
// Порядок:
//   npx vite build && npm run check:prerender
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveDist } from '../build/_serve.mjs';
import { fileFor, SHELL_FILE } from '../build/prerenderPaths.mjs';
import { prerenderedUrls, LOCALISED_PAGES, splitLangPath, PREFIXED_LANGS } from '../../src/lib/routePaths.js';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const PORT = 5177;
/** Столько текста мы обещаем машине минимум. Меньше — значит страница пустая. */
const MIN_TEXT = 1000;

const fails = [];
const ok = [];
const check = (cond, what) => (cond ? ok.push(what) : fails.push(what));

const text = (html) => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  return (body ? body[1] : '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const tag = (html, re) => (re.exec(html) || [, null])[1];

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('нет собранной dist — сначала `npx vite build`');
  process.exit(2);
}

const srv = await serveDist(DIST, PORT, null, SHELL_FILE);
try {
  // ── 1. Испечённые адреса: свой файл, свой текст, свой заголовок ──────────
  for (const url of prerenderedUrls()) {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`);
    const html = await res.text();
    const body = text(html);
    const { lang, path } = splitLangPath(url);

    check(existsSync(join(DIST, fileFor(url))), `${url}: файл собран`);
    check(body.length >= MIN_TEXT, `${url}: текст в документе (${body.length} знаков)`);
    check(tag(html, /<title>([^<]*)<\/title>/), `${url}: свой заголовок`);
    check(tag(html, /rel="canonical" href="([^"]+)"/)?.endsWith(url === '/' ? '.com/' : url),
      `${url}: canonical на себя`);
    check(/<html[^>]*data-prerendered/.test(html), `${url}: помечен как испечённый`);
    check(new RegExp(`<html[^>]*lang="${lang ?? 'en'}"`).test(html), `${url}: язык ${lang ?? 'en'}`);
    check(/<link id="site-css"/.test(html), `${url}: стили объявлены в документе`);
    check(!/id="splash"/.test(html), `${url}: заставки нет`);

    const alts = [...html.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]);
    const want = LOCALISED_PAGES.includes(path) ? ['en', ...PREFIXED_LANGS, 'x-default'].sort() : [];
    check(JSON.stringify(alts.sort()) === JSON.stringify(want),
      `${url}: языковые версии объявлены верно (${alts.length})`);
  }

  // ── 2. Заголовки у всех разные — иначе где-то приехал чужой файл ─────────
  const titles = await Promise.all(prerenderedUrls().map(async (url) => {
    const html = await (await fetch(`http://127.0.0.1:${PORT}${url}`)).text();
    return tag(html, /<title>([^<]*)<\/title>/);
  }));
  const groups = new Map();
  titles.forEach((t, i) => groups.set(t, [...(groups.get(t) || []), prerenderedUrls()[i]]));
  // Демо на трёх языках и лендинг на трёх языках — шесть разных заголовков;
  // юр-страницы свои. Совпадение значит, что адресу отдали чужой файл.
  check(groups.size === prerenderedUrls().length,
    `у всех ${prerenderedUrls().length} адресов свой заголовок`);

  // ── 3. Адрес приложения получает ОБОЛОЧКУ, а не лендинг ─────────────────
  for (const url of ['/trips', '/login', '/kit/splash', '/no-such-page']) {
    const html = await (await fetch(`http://127.0.0.1:${PORT}${url}`)).text();
    // Признак ищем АТРИБУТОМ на <html>, а не подстрокой: сама строка
    // `data-prerendered` живёт и в пре-пейнт скрипте оболочки, который её
    // читает, — поиск по документу поймал бы её там и всегда врал.
    check(text(html).length < 200 && !/<html[^>]*\sdata-prerendered/.test(html),
      `${url}: приезжает оболочка, а не готовая страница`);
  }
} finally {
  srv.close();
}

for (const line of ok) console.log(`  ✓ ${line}`);
if (fails.length) {
  console.error('\nВЫПЕЧКА НЕ В ПОРЯДКЕ:');
  for (const line of fails) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} проверок прошло\nвыпечка в порядке.`);
