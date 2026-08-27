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

// Адрес демо берётся ИЗ ТОЙ ЖЕ константы, что и маршрут, лендинг и карта сайта
// (`DEMO_PATH`) — модуль намеренно без зависимостей ровно ради таких импортов.
// Раньше здесь стоял префикс `/d/`, и это была ошибка в обе стороны: слаг
// оказывался вписан ЧЕТВЁРТЫМ местом, а бот получал 200 и индексируемое превью
// на ЛЮБОЙ `/d/…`, включая опечатку и мёртвую ссылку, — при том что человеку по
// тому же адресу отдаётся 404 (маршрут точный, см. `demoPath.js`).
import { DEMO_PATH } from './src/pages/Demo/demoPath.js';

const BOT_RE = /(bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|pinterest|vkshare|embedly|skypeuripreview|twitter|googlebot|bingbot|yandex|applebot|redditbot|preview)/i;

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
  if (pathname === DEMO_PATH) {
    return page({
      title: 'Demo trip — Triplanio',
      description: 'A live example of a Triplanio trip: the route on a map, a day-by-day timeline, the budget, documents and the Telegram assistant.',
    });
  }
  if (pathname === '/terms') {
    return page({
      title: 'Terms of Service — Triplanio',
      description: 'The agreement between you and Triplanio: what the Service does, what you may do with it, and how it can end.',
    });
  }
  if (pathname === '/privacy') {
    return page({
      title: 'Privacy Policy — Triplanio',
      description: 'What personal data the Service collects, why, how long it is kept, and what rights you have over it.',
    });
  }
  return null;
}

export default function middleware(request) {
  try {
    const { pathname } = new URL(request.url);
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_RE.test(ua)) return; // живой человек → SPA как обычно
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
