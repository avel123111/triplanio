// Vercel Edge Middleware — превью ссылок (Open Graph) для страниц, которые
// рисует JavaScript.
//
// ПРОБЛЕМА, КОТОРУЮ ЭТО РЕШАЕТ. Приложение — SPA: на любой адрес сервер отдаёт
// один и тот же `index.html`, содержимое дорисовывает React. Краулеры превью
// (Telegram, WhatsApp, Slack, Discord, Facebook, X, LinkedIn, VK, iMessage) JS
// НЕ ВЫПОЛНЯЮТ — они читают ровно то, что пришло с сервера. А там лежат
// og-теги ЛЕНДИНГА. Поэтому ссылка на демо-поездку, на публичную поездку и на
// юридический документ показывала получателю карточку лендинга: «Triplanio —
// Your whole trip. One beautiful plan.» с обложкой лендинга.
//
// `useDocumentMeta` в React это не чинит и не может: он ставит заголовок ПОСЛЕ
// загрузки, когда краулер уже ушёл.
//
// Третий механизм заводить не нужно — этот уже работал для приглашений с Ф3,
// здесь он просто перестаёт знать только про `/join/`. Человек получает
// приложение как обычно: функция возвращает undefined, и запрос идёт дальше.
//
// Matcher намеренно не используется — middleware исполняется на каждом запросе
// и решает по pathname внутри. Это самый устойчивый вариант: список путей ниже
// нельзя рассинхронизировать с конфигом, потому что конфига нет.

// Адреса демо здесь больше нет: с TRIP-520 демо приезжает готовым файлом со
// своими og-тегами, и заглушка ему не нужна (см. `previewFor`).
import { isKnownPath, LOCALISED_PAGES, PREFIXED_LANGS, withLangPath } from './src/lib/routePaths.js';
import { SHELL_FILE } from './scripts/build/prerenderPaths.mjs';

// ★ ТОЛЬКО КРАУЛЕРЫ ПРЕВЬЮ. Поисковиков здесь НЕТ, и это несущее.
//
// Раньше список был общим («любой бот») и включал `googlebot`, `bingbot`,
// `yandex` плюс маски `bot|crawl|spider`. Пока заглушку получал один `/join/`
// под `noindex`, это ничего не стоило. С расширением на демо и юр-страницы —
// а они, в отличие от приглашения, ОБЯЗАНЫ индексироваться и лежат в
// `sitemap.xml` — Googlebot стал получать 1231 байт заглушки вместо 7183 байт
// приложения. То есть в индекс уезжала страница, у которой в теле один
// заголовок, ровно там, где мы сами просили её проиндексировать.
//
// Разница между двумя аудиториями простая: краулер превью JavaScript НЕ
// выполняет, поэтому ему нужен готовый HTML; поисковик его ВЫПОЛНЯЕТ и обязан
// получить настоящее приложение. Один список на обоих — это выбор в пользу
// одного за счёт другого.
//
// Список поимённый, а не по маске `bot`: маска ловит и поисковики, и всё
// незнакомое. Цена явного списка — краулер превью, которого в нём нет, получит
// приложение и превью не покажет; это ровно то, что было до Ф11, то есть не
// регресс. Цена маски — испорченный поисковый индекс, и он чинится месяцами.
//
// `applebot` оставлен здесь намеренно: им Apple строит превью в iMessage, и
// это для нас важнее, чем позиция в поиске Siri/Spotlight.
const PREVIEW_UA_RE = /(facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|pinterest|vkshare|vkontakte|embedly|iframely|skypeuripreview|twitter|redditbot|applebot|snapchat|viber|nuzzel|quora link preview|bitlybot|flipboard|tumblr|mastodon|bluesky)/i;

// ★★ МАСКА ШИРОКАЯ ТАМ, ГДЕ ИНДЕКСИРОВАТЬ ЗАПРЕЩЕНО, И УЗКАЯ ТАМ, ГДЕ НУЖНО.
//
// У приглашения и публичной поездки в АДРЕСЕ лежит одноразовый токен доступа, и
// защита от индексации у них ровно одна — `noindex` в этом самом HTML: в
// `robots.txt` стоит `Allow: /` (и стоит намеренно — `Disallow` не дал бы
// краулеру ЗАГРУЗИТЬ страницу, а значит и прочитать её `noindex`).
//
// Пока заглушку получал «любой бот», это работало. Разделение аудиторий выше
// (поисковик обязан получить настоящее приложение) молча сняло защиту ИМЕННО С
// ЭТИХ ДВУХ АДРЕСОВ: Googlebot стал получать SPA, в котором `noindex` не было
// вовсе. Достаточно одной расшаренной ссылки, чтобы share-токен уехал в индекс.
//
// Поэтому правило одно и звучит так: на странице, которую индексировать НЕЛЬЗЯ,
// заглушку с `noindex` получает ЛЮБОЙ бот — цена широкой маски здесь равна нулю,
// терять в поиске нечего. На странице, которую индексировать НУЖНО (демо,
// `/terms`, `/privacy` — они в `sitemap.xml`), маска остаётся поимённой.
const BOT_UA_RE = /(bot|crawl|spider|slurp|preview|fetcher|facebookexternalhit|whatsapp|telegram|embedly|iframely)/i;

// Адреса, у которых токен доступа в URL. Тот же список задаёт `noindex` в
// `previewFor` — держать их порознь нельзя, поэтому предикат один.
const isTokenPath = (pathname) => pathname.startsWith('/join/') || pathname.startsWith('/public/trip/');

const ORIGIN = 'https://www.triplanio.com';

/**
 * Один шаблон на все превью — раньше разметка была константой, и четвёртое
 * превью означало бы четвёртую копию тех же десяти тегов.
 *
 * `noindex` ставится ВЫБОРОЧНО, и это несущее: демо и юридические страницы
 * ДОЛЖНЫ индексироваться (они в `sitemap.xml`), а приглашение и публичная
 * поездка — нет, у них в адресе одноразовый токен доступа. Раньше `noindex`
 * стоял в разметке жёстко, потому что случай был ровно один.
 */
const page = ({ title, description, image = 'og-cover.jpg', noindex = false }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow">'}
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Triplanio">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${ORIGIN}/${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ORIGIN}/${image}">
</head>
<body>${title}</body>
</html>`;

/**
 * Что отдать боту на этот адрес. `null` — превью не наше, пусть идёт в SPA.
 *
 * Тексты здесь ТОЛЬКО английские и НЕ через i18n — сознательно, как и у
 * юридических страниц: краулер приходит без нашей локали и без JS, выбирать
 * язык не по чему. Один honest fallback лучше, чем угаданный не тот.
 *
 * Порядок проверок = от частного к общему. Демо сверяется ТОЧНЫМ адресом: только
 * он существует как страница, а превью обязано совпадать с тем, что получит
 * человек. Переехавший слаг (`spain-may-27` → `europe-may-2027`) закрыт
 * постоянным редиректом в `vercel.json` — краулер идёт по нему и получает
 * превью уже на каноническом адресе; здесь его дублировать не нужно.
 */
function previewFor(pathname) {
  if (pathname.startsWith('/join/')) {
    return page({
      title: "You've been invited to a Triplanio trip",
      description: 'See the route, split the budget, and plan together.',
      image: 'og-join.jpg',
      noindex: true, // одноразовый токен приглашения в адресе
    });
  }
  if (pathname.startsWith('/public/trip/')) {
    return page({
      title: 'A trip on Triplanio',
      description: 'The route on a map, a day-by-day timeline, the budget and who is going.',
      noindex: true, // share-токен в адресе
    });
  }
  // ★ ДЕМО И ЮР-СТРАНИЦ ЗДЕСЬ БОЛЬШЕ НЕТ (TRIP-520). Они приезжают готовыми
  // файлами, и og-теги в них СВОИ — выведены из настоящего заголовка страницы
  // при выпечке. Заглушка была нужна ровно потому, что файла не было; оставь мы
  // её, у одной страницы стало бы два описания в двух местах, и первое же
  // изменение текста разошлось бы молча.
  //
  // Осталось то, что испечь нельзя по построению: приглашение и публичная
  // поездка. У них в адресе одноразовый токен, содержимое своё у каждой ссылки,
  // и `noindex` в этой самой заглушке — единственная защита от индексации.
  return null;
}

/**
 * Адрес, которого нет, отвечает 404 — ДО того, как загрузится приложение.
 *
 * ПОЧЕМУ КРАЙ, А НЕ REACT. Приложение уже рисует свою 404 с `noindex`, но и то
 * и другое появляется только ПОСЛЕ выполнения JavaScript, а статус из React не
 * изменить вовсе: `vercel.json` отдаёт `index.html` с 200 на любой путь. Для
 * тех, кто JS не выполняет (краулеры движков ответов, часть поисковых, сканеры
 * ссылок), «страницы нет» и «страница есть» выглядели одинаково успешно —
 * замер 31.08: выдуманный адрес собрал за два часа десяток заходов, часть из
 * поиска, и каждому был отдан 200 с содержимым главной.
 *
 * ТЕЛО берётся у приложения: человек по битой ссылке обязан увидеть нашу 404 со
 * стилями, меняются только статус и заголовок. Нет оболочки — минимальное тело
 * с тем же статусом: 404 без стилей лучше, чем 200 с лендингом.
 *
 * Что считается существующим — `isKnownPath`, там же, где маршрутизация берёт
 * свои списки: второй список адресов отдал бы 404 на живом экране.
 */
async function notFound(request) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    // Второй носитель запрета, для тех, кто до `<meta>` в приложении не дойдёт.
    'x-robots-tag': 'noindex',
    'cache-control': 'public, max-age=0, must-revalidate',
  };
  try {
    // ★ ОБОЛОЧКА, А НЕ `index.html`: с приходом выпечки по `index.html` лежит
    // ЛЕНДИНГ (TRIP-520). Отдай мы его — на битом адресе человек увидел бы
    // главную страницу под статусом 404, то есть ровно ту подмену, ради
    // устранения которой этот ответ и существует.
    const shell = await fetch(new URL(`/${SHELL_FILE}`, request.url));
    return new Response(await shell.text(), { status: 404, headers });
  } catch {
    return new Response('<!doctype html><meta name="robots" content="noindex"><title>404</title>Not found', { status: 404, headers });
  }
}

/**
 * `?lang=es` на бесперфиксном адресе переведённой страницы → её ИСПАНСКИЙ АДРЕС.
 *
 * Параметром язык форсят рекламные ссылки (TRIP-511/487), и до выпечки это был
 * единственный способ приземлить испанскую кампанию на испанский экран. Теперь у
 * испанской страницы есть свой файл, и оставь мы прежнее поведение — платный
 * посетитель получал бы АНГЛИЙСКИЙ файл, который через полторы секунды
 * перерисовывался бы в испанский. Переезд отдаёт нужный файл сразу.
 *
 * Только на переведённых страницах и только на бесперфиксных: `?lang=` на входе
 * и публичной поездке работает как работал — там языкового адреса нет.
 * Временный (307), а не постоянный: адрес назначения зависит от параметра, и
 * закреплять такую пару в кэше браузера нельзя.
 */
function localeRedirect(href, pathname) {
  if (!LOCALISED_PAGES.includes(pathname)) return undefined;
  const url = new URL(href);
  const lang = url.searchParams.get('lang');
  if (!PREFIXED_LANGS.includes(lang)) return undefined;
  url.searchParams.delete('lang');
  url.pathname = withLangPath(lang, pathname);
  return new Response(null, { status: 307, headers: { location: url.pathname + url.search + url.hash } });
}

export default function middleware(request) {
  try {
    const { pathname } = new URL(request.url);
    // ★ СНАЧАЛА «есть ли такая страница», и только потом «кто спрашивает».
    // Существование адреса — свойство САМОГО адреса, а не посетителя: спроси
    // сперва про User-Agent, и краулер превью проскочит мимо проверки и получит
    // 200 там, где человеку отдаётся 404.
    if (!isKnownPath(pathname)) return notFound(request);
    const langRedirect = localeRedirect(request.url, pathname);
    if (langRedirect) return langRedirect;
    const ua = request.headers.get('user-agent') || '';
    // На токен-адресе заглушку получает любой бот (она несёт `noindex`), на
    // остальных — только краулер превью: поисковику там нужно приложение.
    const wants = isTokenPath(pathname) ? BOT_UA_RE.test(ua) : PREVIEW_UA_RE.test(ua);
    if (!wants) return; // человек (и поисковик на индексируемом адресе) → SPA
    const html = previewFor(pathname);
    if (!html) return; // не наш адрес → SPA как обычно
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch {
    return; // превью никогда не имеет права уронить сам запрос
  }
}
