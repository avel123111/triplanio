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
 * Не-страницы зоны и не экраны приложения: статика, rewrite'ы наружу и ветки,
 * которые `App.jsx` маршрутизирует САМ, до гейта авторизации (`/join/`,
 * `/public/trip/`, `/kit`, `/email-preferences`). Судьбу первых решает
 * платформа (`vercel.json`), вторых — своя ветка в `App.jsx`; общее у них одно
 * — по адресу что-то есть, и край не имеет права отдать на него 404.
 */
const PASSTHROUGH_PREFIXES = ['/api/', '/ingest/', '/join/', '/public/trip/', '/assets/', '/kit/'];
const PASSTHROUGH_EXACT = ['/kit', '/index.html', '/email-preferences'];

/**
 * Страницы нет, но есть постоянный редирект в `vercel.json`. Оборви её 404-м —
 * и вместо переезда человек получит «не найдено». Сверяется с самим конфигом
 * тестом, поэтому списки разъехаться не могут.
 */
const REDIRECT_SOURCES = ['/d/spain-may-27'];

/** Совпадает ли адрес с шаблоном (`/trip/:tripId`). Свой матчер: предикат зовёт
 *  и edge-middleware, куда react-router не приезжает. */
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
 * Существует ли по адресу хоть что-нибудь — страница, экран, статика или чужая
 * ветка маршрутизации. Нужен краю, чтобы ответить 404 честным статусом ДО
 * загрузки приложения (зачем именно — в докблоке `notFound` в `middleware.js`).
 *
 * Хвостовой слэш нормализуется: `/terms/` — тот же адрес, что `/terms`.
 */
export function isKnownPath(pathname) {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (isZonePage(path) || isAppRoute(path)) return true;
  if (REDIRECT_SOURCES.includes(path) || PASSTHROUGH_EXACT.includes(path)) return true;
  if (PASSTHROUGH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Файлоподобное имя — статика, её судьбу решает платформа.
  return path.slice(path.lastIndexOf('/')).includes('.');
}
