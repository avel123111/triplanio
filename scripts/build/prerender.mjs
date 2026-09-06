// Выпечка публичных страниц: готовый HTML вместо пустой коробки (TRIP-520).
//
// ── ЗАЧЕМ ────────────────────────────────────────────────────────────────────
// Приложение — SPA: на любой адрес сервер отдаёт один и тот же документ, а
// содержимое дорисовывает JavaScript. Браузер человека это умеет; поисковый
// робот ChatGPT, робот Perplexity и любой читатель без JS — нет. Замер прода
// 05.09.2026: 11 176 байт документа и РОВНО НОЛЬ символов текста в `<body>` для
// `OAI-SearchBot`, `ChatGPT-User`, `GPTBot` и `PerplexityBot`. Тридцать девять
// тысяч знаков, которые у нас написаны, для машины не существовали.
//
// Здесь мы один раз, на сборке, собираем коробку сами и кладём на сервер
// готовую страницу. Это не «версия для роботов»: файл ОДИН и достаётся всем.
//
// ── ПОЧЕМУ НЕ ГИДРАЦИЯ ───────────────────────────────────────────────────────
// Обычный ход — попросить React «принять» готовую разметку вместо перерисовки.
// Он требует, чтобы первый клиентский кадр совпал с файлом до буквы, а у нас он
// не совпадёт никогда: ширина экрана решает ветки раскладки, баннер согласия
// есть в файле и нет у ответившего, стили зоны подключаются рантаймом. Поэтому
// React как рисовал заново, так и рисует; готовый файл нужен затем, чтобы
// СОДЕРЖИМОЕ приехало вместе с документом, а не через три круга загрузки.
//
// ── ЧТО ЗДЕСЬ ЛЕГКО СЛОМАТЬ ──────────────────────────────────────────────────
// 1. ХОСТ. Приложение проверяет `window.location.hostname` и на не-проде НЕ
//    ставит canonical (`SiteChrome`), зато подгружает дев-инструмент. Печём под
//    настоящим именем домена (`--host-resolver-rules`), иначе получаем файлы без
//    canonical и с дев-кодом — зелёно на вид, разрушительно для выдачи.
// 2. СНИМАЕМ НЕ ВЕСЬ ДОКУМЕНТ, А СОДЕРЖИМОЕ. Приложение УДАЛЯЕТ заставку из
//    дерева, когда готово; сохрани мы «что получилось», в файле не осталось бы
//    ни заставки, ни исходных комментариев, зато приехали бы рантаймовые
//    артефакты. Поэтому берём `#root` и нужные узлы шапки и вкладываем их в
//    собранный шаблон.
// 3. СЕТЬ НАРУЖУ ЗАКРЫТА. Карта, Supabase, аналитика на сборке не нужны и
//    делают результат недетерминированным (а демо с живой картой печётся 15 с
//    вместо 3). Всё, что не наш origin, обрывается.
// 4. ОШИБКА СТРАНИЦЫ = КРАСНАЯ СБОРКА. Иначе битая страница молча уезжает в
//    прод готовым файлом, а Sentry получает её из CI как «ошибку у пользователя».
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { chromium } from 'playwright-core';

import { serveDist } from './_serve.mjs';
import { SHELL_FILE, fileFor } from './prerenderPaths.mjs';
import { compose } from './composePage.mjs';
import { prerenderedUrls } from '../../src/lib/routePaths.js';

/** Имя, под которым печём: от него зависит и canonical, и отсутствие дев-кода. */
const PROD_HOST = 'www.triplanio.com';
const PORT = 5099;

/** Снять со страницы всё, что должно попасть в файл. */
const SNAPSHOT = () => {
  const head = [];
  const push = (sel) => document.querySelectorAll(sel).forEach((el) => head.push(el.outerHTML));
  push('link[rel="canonical"]');
  push('link[rel="alternate"][hreflang]');
  // JSON-LD страницы (FAQPage и прочее) — общесайтовый блок уже в шаблоне.
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    if (!el.textContent.includes('"@graph"')) head.push(el.outerHTML);
  });
  return {
    lang: document.documentElement.lang || 'en',
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    root: document.getElementById('root')?.innerHTML || '',
    text: (document.getElementById('root')?.innerText || '').replace(/\s+/g, ' ').trim(),
    head: head.map((h) => `  ${h}\n`).join(''),
  };
};

/**
 * Испечь все публичные страницы в каталог сборки.
 * @param {string} outDir каталог сборки (`dist`)
 */
export async function prerender(outDir) {
  const indexPath = join(outDir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`prerender: нет ${indexPath} — сборка не дошла до конца`);
  // Оболочка отделяется ПЕРВОЙ: `index.html` дальше занимает лендинг.
  copyFileSync(indexPath, join(outDir, SHELL_FILE));
  const template = readFileSync(indexPath, 'utf8');

  const missed = [];
  // ★ ФОЛБЭК — ОБОЛОЧКА, А НЕ `index.html`. Лендинг печётся ПЕРВЫМ и занимает
  // `index.html`; оставь мы фолбэк на него, следующая страница грузилась бы
  // из уже испечённого лендинга и утаскивала в свою шапку его canonical и
  // его список языков (замер: у `/terms` появлялись hreflang лендинга).
  const srv = await serveDist(outDir, PORT, (p) => missed.push(p), SHELL_FILE);
  const browser = await chromium.launch({
    // Путь называется снаружи там, где браузер положен заранее (наш
    // dev-контейнер); в сборке Vercel его ставит `ensure-chromium.mjs`, и
    // playwright находит его сам.
    ...(process.env.PRERENDER_CHROMIUM ? { executablePath: process.env.PRERENDER_CHROMIUM } : {}),
    args: [`--host-resolver-rules=MAP ${PROD_HOST}:80 127.0.0.1:${PORT}`, '--no-sandbox'],
  });
  const started = Date.now();
  try {
    const ctx = await browser.newContext();
    // Всё, что не наш origin, обрывается: карта, база, аналитика на сборке не
    // нужны, а без этого демо печётся 15 секунд вместо трёх и зависит от сети.
    //
    // `/_vercel/*` — тоже наружу, хоть и на нашем адресе: эти файлы отдаёт
    // ПЛАТФОРМА, в каталоге сборки их нет. Пока сервер выпечки подменял
    // недостающий скрипт html-фолбэком, это выглядело как «Unexpected token '<'»
    // на демо-странице — то есть ошибка приезжала не туда, где причина.
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      const ours = url.includes(PROD_HOST) && !url.includes('/_vercel/');
      return ours ? route.continue() : route.abort();
    });

    for (const url of prerenderedUrls()) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://${PROD_HOST}${url}`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForFunction(
        () => (document.getElementById('root')?.innerText || '').trim().length > 300,
        { timeout: 30_000 },
      ).catch(() => { throw new Error(`prerender: ${url} не нарисовал содержимое`); });
      const snap = await page.evaluate(SNAPSHOT);
      if (missed.length) throw new Error(`prerender: ${url} просил файлы, которых нет в сборке: ${[...new Set(missed)].slice(0, 5).join(', ')}`);
      if (errors.length) throw new Error(`prerender: ${url} упал с ошибкой — ${errors[0].slice(0, 300)}`);
      if (!snap.title) throw new Error(`prerender: у ${url} нет заголовка`);

      const file = join(outDir, fileFor(url));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, compose(template, snap));
      console.log(`  ${url.padEnd(28)} ${String(snap.text.length).padStart(6)} знаков  lang=${snap.lang}`);
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`  выпечка заняла ${((Date.now() - started) / 1000).toFixed(1)} с`);
}
