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
 * ★ СТРАНИЦЫ, КОТОРЫЕ ПЕЧЁТСЯ ГОТОВЫМИ НА СБОРКЕ (TRIP-520).
 *
 * Признак у них один и он же — критерий: содержимое НЕ зависит от того, кто
 * открыл. У остальных страниц зоны зависит — вход рисует форму под состояние
 * сессии, приглашение и публичная поездка тянут свои данные по токену, — и
 * испечь их нечем.
 *
 * Из этого списка выводятся ТРИ вещи, и ни одна не выписана вторым местом:
 * что обходит выпечка (`scripts/build/prerender.mjs`), что лежит в карте сайта
 * и что проверяет гард `check:prerender`.
 */
export const PRERENDERED_PAGES = ['/', DEMO_PATH, '/terms', '/privacy'];

/**
 * ★ ИСПЕЧЁННАЯ ≠ ПЕРЕВЕДЁННАЯ. Языковые адреса есть только у этих двух.
 *
 * Юридические документы английские ПО РЕШЕНИЮ (TRIP-465, §7 хендоффа): договор
 * правится целиком как текст, а не по строкам через `t()`, и его проза лежит
 * английской разметкой в `pages/legal/*.en.html`. Дай мы им `/ru/terms`, и
 * получилось бы худшее из возможного: три РАЗНЫХ адреса с ОДНИМ английским
 * текстом (для поисковика — дубли, конкурирующие между собой), список языковых
 * версий, обещающий русскую страницу и отдающий английскую, и `lang="ru"` на
 * английской прозе — ровно та причина, по которой встроенный переводчик
 * предлагает перевод и ломает DOM (TRIP-515).
 *
 * Печём мы их всё равно: готовый HTML нужен ботам независимо от числа языков.
 */
export const LOCALISED_PAGES = ['/', DEMO_PATH];

/**
 * ★ ЯЗЫК ЖИВЁТ В АДРЕСЕ, И АНГЛИЙСКИЙ ЖИВЁТ БЕЗ ПРЕФИКСА (TRIP-520).
 *
 * `/` — канонический английский адрес, `/es/…` и `/ru/…` — самостоятельные
 * страницы своих языков. Английский без префикса не «привилегия», а следствие:
 * это адрес, на который ведут ВСЕ уже существующие ссылки на нас — проверка
 * Google, карта сайта, `llms.txt`, теги соцсетей, чужие упоминания. Заведи мы
 * `/en/`, и та же страница получила бы два адреса: поисковик считает их
 * дублями и делит вес, а переключатель языка перестаёт знать, какой из них
 * настоящий. `/en/*` поэтому не существует как страница — платформа отвечает на
 * него постоянным переездом на бесперфиксный адрес (`vercel.json`).
 *
 * Список ЛИТЕРАЛОМ, а не выводом из `LANGUAGES`: обратный импорт замкнул бы
 * цикл (`translations` → `routePaths` → `translations`), а этот модуль обязан
 * открываться голым `node --test` и его же читает edge-middleware. Разъехаться
 * с настоящим списком языков не даёт `routePaths.test.js` — та же связка
 * «литерал + тест», которой живёт пре-пейнт скрипт в `index.html`.
 */
export const PREFIXED_LANGS = ['es', 'ru'];

/**
 * Разобрать адрес на язык и путь без языка.
 *
 * Голый префикс (`/es`) и префикс со слэшем (`/es/`) — ОДИН адрес, главная
 * своего языка: иначе `/es` провалилось бы в 404, а именно так эту ссылку и
 * набирают руками.
 *
 * @param {string} pathname
 * @returns {{ lang: 'es'|'ru'|null, path: string }} `lang` = null у английского
 */
export function splitLangPath(pathname) {
  const seg = pathname.split('/')[1];
  if (!PREFIXED_LANGS.includes(seg)) return { lang: null, path: pathname };
  const rest = pathname.slice(seg.length + 1);
  return { lang: seg, path: rest === '' ? '/' : rest };
}

/**
 * Собрать адрес страницы на нужном языке. Обратная к `splitLangPath`.
 *
 * @param {string} lang  код языка; английский (и любой беспрефиксный) отдаёт путь как есть
 * @param {string} path  путь БЕЗ языкового префикса
 * @returns {string}
 */
export function withLangPath(lang, path) {
  if (!PREFIXED_LANGS.includes(lang)) return path;
  return path === '/' ? `/${lang}` : `/${lang}${path}`;
}

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
  const { lang, path } = splitLangPath(pathname);
  // Под языковым префиксом живут ТОЛЬКО испечённые страницы: префикс — это имя
  // готового файла, а у входа и приглашения такого файла нет и быть не может
  // (их содержимое зависит от того, кто открыл). Ссылки из языковой страницы в
  // функциональную несут язык параметром `?lang=` — тем же, которым он уже
  // ездит в рекламных ссылках, а не вторым механизмом.
  if (lang) return LOCALISED_PAGES.includes(path) || path.startsWith('/d/');
  return ZONE_PAGES.includes(path) || path.startsWith('/d/');
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
  const { lang, path } = splitLangPath(pathname);
  return lang ? LOCALISED_PAGES.includes(path) : ZONE_PAGES.includes(path);
}

/**
 * Все адреса, которые печёт сборка и перечисляет карта сайта: испечённые
 * страницы × языки. Английский без префикса, поэтому первым идёт он сам.
 *
 * @returns {string[]}
 */
export function prerenderedUrls() {
  return PRERENDERED_PAGES.flatMap((path) => [
    path,
    ...(LOCALISED_PAGES.includes(path) ? PREFIXED_LANGS.map((lang) => withLangPath(lang, path)) : []),
  ]);
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

/** Префиксы, на которые платформа отвечает переездом (`vercel.json`). `/en/…`
 *  страницей не является — английский живёт без префикса, — но и 404 ему
 *  отдавать нельзя: человек по такой ссылке обязан приехать на страницу. */
const REDIRECT_PREFIXES = ['/en/'];

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
  if (path === '/en' || REDIRECT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (PASSTHROUGH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Файлоподобное имя — статика, её судьбу решает платформа.
  return path.slice(path.lastIndexOf('/')).includes('.');
}
