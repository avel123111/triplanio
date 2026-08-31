// Адреса сайта как ДАННЫЕ, а не как условие внутри компонента (TRIP-497).
//
// ЗАЧЕМ. Три решения задают об адресе один и тот же вопрос — «а что это за
// адрес вообще»:
//   · `App.jsx`  — рисовать зону или приложение;
//   · `App.jsx`  — незалогиненному на чужом адресе показать 404, а на адресе
//                  ПРИЛОЖЕНИЯ отправить его во вход с возвратом;
//   · `SiteZone` — вешать ли `canonical`.
// Пока ответ выписан в каждом месте своим `path === '/' || …`, третье место
// молча отстаёт от первых двух: новая страница зоны появляется в маршрутах, а
// `canonical` на неё не приезжает, и не краснеет ничего. Тот же ход, каким в
// этом же эпике вынесены `demoPath.js` и `postLoginPath.js`: у решения, которое
// стоит трафика, должен быть один дом и тест на чистой функции.
//
// Списки НЕ дублируют таблицы `<Routes>` — расхождение с ними ловит
// `routePaths.test.js`, разбирая сами таблицы. Дубль, за которым следит тест,
// честнее, чем импорт маршрутов из `AuthenticatedShell`: тот приезжает своим
// чанком и не имеет права попасть в граф лендинга (TRIP-475).
//
// Импорт ОТНОСИТЕЛЬНЫЙ и с расширением — как в `middleware.js`: модуль обязан
// открываться голым `node --test`, а алиас `@/` умеет разворачивать только Vite.
import { DEMO_PATH } from '../pages/Demo/demoPath.js';

/**
 * СТРАНИЦЫ неавторизованной зоны — точные адреса, каждый существует.
 * Порядок и состав = таблица маршрутов зоны в `App.jsx`.
 */
export const ZONE_PAGES = [
  '/',
  DEMO_PATH,
  '/terms',
  '/privacy',
  '/login',
  '/reset-password',
];

/**
 * Маршруты приложения — шаблоны react-router (с параметрами).
 * Состав = таблица маршрутов в `AuthenticatedShell.jsx`.
 */
export const APP_ROUTES = [
  '/trips',
  '/stats',
  '/new-trip',
  '/trip/:tripId',
  '/trip/:tripId/edit',
  '/settings',
  '/inbox',
  '/pro',
  '/plan-trip-ai',
];

/**
 * Ведёт ли адрес в зону — то есть рисует ли его оболочка зоны.
 *
 * `/d/` префиксом, а не точным `DEMO_PATH`: чужой слаг (`/d/opechatka`) обязан
 * попасть в зону и получить её 404 — со шапкой, подвалом и стилями сайта, а не
 * 404 приложения, собранный из другой дизайн-системы.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isZoneRoute(pathname) {
  return ZONE_PAGES.includes(pathname) || pathname.startsWith('/d/');
}

/**
 * Существует ли по этому адресу СТРАНИЦА зоны.
 *
 * Отличие от `isZoneRoute` — ровно чужой `/d/`-слаг: он в зону ведёт, но
 * страницей не является. Именно на этом различии стоит `canonical`: объявлять
 * адрес каноническим можно только тогда, когда по нему что-то есть.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isZonePage(pathname) {
  return ZONE_PAGES.includes(pathname);
}

/**
 * Префиксы, которые НЕ являются страницами приложения и разбираются платформой
 * или отдельной веткой маршрутизации. Сюда middleware не лезет.
 *
 * `/assets/` и всё файлоподобное (с точкой в имени) — статика: её судьбу уже
 * решает `vercel.json` (пропавший чанк отдаёт 404, TRIP-284). `/api/` и
 * `/ingest/` — rewrite'ы наружу. `/join/` и `/public/trip/` — свои ветки со
 * своим превью и `noindex`. `/kit` — витрина вне прода.
 */
const PASSTHROUGH_PREFIXES = ['/api/', '/ingest/', '/join/', '/public/trip/', '/assets/', '/kit/'];
const PASSTHROUGH_EXACT = ['/kit', '/index.html'];

/**
 * Адреса, которых в маршрутах НЕТ, но которые обязаны дойти до платформы: у них
 * постоянный редирект в `vercel.json`. Оборви их раньше — и вместо переезда на
 * канонический адрес человек получит 404.
 *
 * Список сверяется с самим `vercel.json` тестом: разъехаться они не могут.
 */
const REDIRECT_SOURCES = ['/d/spain-may-27'];

/**
 * Совпадает ли адрес с шаблоном маршрута (`/trip/:tripId`).
 *
 * Свой матчер на пять строк, а не react-router: предикат зовёт ещё и edge-
 * middleware, куда роутер не приезжает и не должен.
 *
 * @param {string} pathname
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesPattern(pathname, pattern) {
  const a = pathname.split('/');
  const b = pattern.split('/');
  if (a.length !== b.length) return false;
  return b.every((seg, i) => (seg.startsWith(':') ? a[i].length > 0 : seg === a[i]));
}

/** Ведёт ли адрес на экран приложения (шаблоны с параметрами тоже). */
export function isAppRoute(pathname) {
  return APP_ROUTES.some((pattern) => matchesPattern(pathname, pattern));
}

/**
 * Существует ли по этому адресу ХОТЬ ЧТО-НИБУДЬ — страница, экран приложения,
 * статика или чужая ветка маршрутизации.
 *
 * ЗАЧЕМ. Сервер на любой адрес отдаёт `index.html` со статусом 200: правило
 * SPA-фолбэка не знает про маршруты, их знает только React. Для того, кто
 * JavaScript не выполняет — а это все краулеры движков ответов и половина
 * поисковых — «страницы нет» и «страница есть» выглядят одинаково успешно.
 * Замер 31.08: выдуманный адрес, названный в публичном тексте, за два часа
 * собрал десяток заходов, часть из поиска, и каждому был отдан 200 с
 * содержимым главной. Предикат нужен, чтобы край мог ответить честно ДО того,
 * как приложение вообще загрузится.
 *
 * Хвостовой слэш нормализуется: `/terms/` — тот же адрес, что `/terms`.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isKnownPath(pathname) {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (isZonePage(path) || isAppRoute(path)) return true;
  if (REDIRECT_SOURCES.includes(path) || PASSTHROUGH_EXACT.includes(path)) return true;
  if (PASSTHROUGH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Файлоподобное имя — это статика, и её судьбу решает платформа, а не мы.
  return path.slice(path.lastIndexOf('/')).includes('.');
}
