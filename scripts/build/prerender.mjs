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
import { platformServedPrefixes } from './platformPaths.mjs';
import { compose } from './composePage.mjs';
import { prerenderedUrls, DEFAULT_LANG } from '../../src/lib/routePaths.js';

/** Имя, под которым печём: от него зависит и canonical, и отсутствие дев-кода. */
const PROD_HOST = 'www.triplanio.com';
const PORT = 5099;

/**
 * ★ ГДЕ ВЗЯТЬ БРАУЗЕР В СБОРОЧНОМ КОНТЕЙНЕРЕ (TRIP-520).
 *
 * Фронт собирается НА СТОРОНЕ VERCEL — так решено в TRIP-134: часть переменных
 * помечена Sensitive и приезжает только там, собери мы локально с `--prebuilt`,
 * в бандл уехали бы пустые `VITE_*` и белый экран. Значит и выпечка идёт в их
 * контейнере.
 *
 * ПЕРВАЯ ПОПЫТКА БЫЛА НЕВЕРНОЙ и стоила красной сборки: `playwright install
 * chromium` там отрабатывает (114 МБ качаются), а запуск падает —
 * `libnspr4.so: cannot open shared object file`. Образ Vercel — Amazon Linux, в
 * нём нет системных библиотек, которые нужны обычной сборке Chromium, и
 * доставить их в сборку нечем.
 *
 * Поэтому браузер берётся из `@sparticuz/chromium` — сборки, сделанной ровно под
 * эту платформу: она везёт свои библиотеки с собой и не зависит от того, что
 * оказалось в образе.
 *
 * Порядок поиска — от явного к общему:
 *   1. `PRERENDER_CHROMIUM` — путь назван снаружи (наш dev-контейнер);
 *   2. `@sparticuz/chromium` — серверless-сборка, ею живёт CI;
 *   3. то, что найдёт сам playwright — обычная машина разработчика.
 */
async function resolveBrowser() {
  if (process.env.PRERENDER_CHROMIUM) {
    return { executablePath: process.env.PRERENDER_CHROMIUM, extraArgs: [] };
  }
  // Выбор по ПЛАТФОРМЕ, а не «попробуй и посмотри»: своя сборка — линуксовая, и
  // на macOS её просто нет; браузер playwright, наоборот, стоит у разработчика и
  // отсутствует в сборочных контейнерах. Гадание дало бы разное поведение у
  // разных людей на одном и том же коде.
  //
  // Линукс здесь — это ВСЕ сборочные среды сразу: контейнер Vercel, раннер
  // GitHub Actions (`npm run build` в гарде фронта) и dev-контейнер. Привяжи мы
  // выбор к признаку одной из них (`process.env.VERCEL`), и остальные молча
  // остались бы без браузера — CI покраснел бы там же, где и платформа.
  if (process.platform === 'linux') {
    const { default: serverless } = await import('@sparticuz/chromium');
    return { executablePath: await serverless.executablePath(), extraArgs: serverless.args };
  }
  return { executablePath: undefined, extraArgs: [] };
}

/** Снять со страницы всё, что должно попасть в файл. */
const SNAPSHOT = () => {
  const head = [];
  const push = (sel) => document.querySelectorAll(sel).forEach((el) => head.push(el.outerHTML));
  push('link[rel="canonical"]');
  push('link[rel="alternate"][hreflang]');

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
  const { executablePath, extraArgs } = await resolveBrowser();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...extraArgs, `--host-resolver-rules=MAP ${PROD_HOST}:80 127.0.0.1:${PORT}`, '--no-sandbox'],
  }).catch((e) => {
    // Падаем громко и с адресом проблемы: молчаливый пропуск выпечки означал бы
    // прод, в котором публичные страницы снова пусты для машин, — и никто бы
    // об этом не узнал. Аварийный клапан назван прямо, чтобы красную выкладку
    // можно было разблокировать без отката.
    throw new Error(
      `prerender: браузер не запустился — ${e.message}\n`
      + '  Выпечка обязательна: без неё публичные страницы уезжают в прод пустыми для поисковиков.\n'
      + '  Разблокировать выкладку, не откатывая PR: переменная сборки SKIP_PRERENDER=1 (осознанно и временно).',
    );
  });
  const started = Date.now();
  try {
    // Всё, что не наш origin, обрывается: карта, база, аналитика на сборке не
    // нужны, а без этого демо печётся 15 секунд вместо трёх и зависит от сети.
    //
    // ★ «НАШ АДРЕС» ≠ «ЛЕЖИТ В СБОРКЕ». Часть путей на нашем же домене отдаёт
    // ПЛАТФОРМА, а не каталог сборки: приёмник аналитики (`/ingest/*`),
    // прокси-функция (`/api/*`), веб-аналитика Vercel (`/_vercel/*`). В `dist`
    // их нет и быть не должно. Пока сервер выпечки подменял такой запрос
    // html-фолбэком, это выглядело как «Unexpected token '<'» в случайном месте;
    // когда фолбэк убрали — как «просил файлы, которых нет в сборке», и сборка
    // краснела на ровном месте (замер: PostHog просит
    // `/ingest/array/<токен>/config.js`, и только там, где токен задан, — то
    // есть на платформе и не локально).
    //
    // Список НЕ выписан руками: он выводится из самого `vercel.json`, где эти
    // переписывания и объявлены. Второй перечень разошёлся бы с первым на первом
    // же новом внешнем сервисе — и снова красной сборкой.
    const platformPaths = platformServedPrefixes();

    for (const url of prerenderedUrls()) {
      // ★★ КАЖДАЯ СТРАНИЦА ПЕЧЁТСЯ КАК ПЕРВЫЙ В ЖИЗНИ ВИЗИТ (TRIP-520).
      //
      // Свой контекст на страницу — то есть чистое хранилище и заданная локаль.
      // Оба свойства несущие, и оба выяснились замером:
      //
      // · ХРАНИЛИЩЕ. Один контекст на все восемь адресов делал выпечку зависимой
      //   от ПОРЯДКА: `/ru` запоминает свой язык на устройстве (это верно —
      //   языковой адрес обязан доехать до входа), и следующий за ним `/terms`,
      //   у которого языковых версий нет, читал это «устройство» и получал
      //   `lang="ru"` на английском юридическом документе. Файл, который
      //   достаётся всем, уносил след другой страницы.
      //
      // · ЛОКАЛЬ. Последняя ступень «языка посетителя» — язык браузера, а в
      //   браузере выпечки он какой угодно. Пинуем язык по умолчанию: под
      //   беспрефиксным адресом лежит именно он.
      //
      // Это та же линия, что и обрыв сети наружу и заданное имя хоста: результат
      // обязан зависеть только от кода, а сборочная машина — не посетитель.
      const ctx = await browser.newContext({ locale: DEFAULT_LANG });
      await ctx.route('**/*', (route) => {
        const req = new URL(route.request().url());
        const ours = req.host === PROD_HOST
          && !platformPaths.some((prefix) => req.pathname.startsWith(prefix));
        return ours ? route.continue() : route.abort();
      });
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
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`  выпечка заняла ${((Date.now() - started) / 1000).toFixed(1)} с`);
}
