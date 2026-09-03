import { lazy, Suspense, useEffect } from 'react'
// ★ `<Toaster>` БЕРЁТСЯ ИЗ СВОЕГО МОДУЛЯ, А НЕ ИЗ БАРРЕЛЯ `@/design/index`
// (TRIP-475). Любое имя, взятое из барреля, делает весь баррель узлом графа
// лендинга, а он тянет слой оверлеев (диалоги → шторки → vaul). Сам компонент
// при этом НЕ переезжал: он и был и остался в `components/ui`, баррель лишь
// перепродавал его наружу.
//
// Следствие для метрики: аудит ДС классифицирует элемент по ПУТИ ИМПОРТА, и
// два `<Toaster>` ниже переехали из кучи `ds` в кучу «легаси components/ui»,
// то есть доля ДС падает на 5 bp (4284 → 4279). Это не регресс разметки —
// это снятие грима: баррель выдавал легаси-компонент за элемент системы.
// Вернуть 5 bp честно можно только одним способом — по-настоящему завести
// тосты в ДС, и это отдельная работа с апрувом, а не строчка в этом PR.
/* floor-exempt: dsshare +5 — `<Toaster>` снят с барреля ради лендинга; сам компонент как был в components/ui, так и остался (апрув Pavel в PR) */
import { Toaster } from "@/components/ui/toaster"
import { track } from '@/lib/analytics'
import { isProdHost } from '@/lib/analyticsEnv'
import { Analytics } from '@vercel/analytics/react'
import ConsentBanner from '@/components/ConsentBanner'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { hideSplash } from '@/lib/splash';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider, useI18n } from '@/lib/i18n/I18nContext';
// ★ ПРЯМО ИЗ СВОИХ МОДУЛЕЙ, А НЕ ЧЕРЕЗ БАРРЕЛЬ `@/design/index` (TRIP-475).
// Оба и так самостоятельные файлы; импорт через баррель тащил на лендинг весь
// слой оверлеев (диалоги → шторки → vaul), который анониму не показывается.
import AppLoading from '@/design/AppLoading';
import LandingPage from '@/pages/Landing/LandingPage';
import { SiteZone } from '@/components/site/SiteChrome';
import { DEMO_PATH } from '@/pages/Demo/demoPath';
import { APP_ROUTES, GUEST_PLANNER_PATH, PLANNER_PATH, canonicalPath, isZoneRoute } from '@/lib/routePaths';
import { initialAuthView } from '@/lib/authEntry';
import { rememberPostLogin } from '@/lib/postLoginPath';
import { zoneLogin } from '@/components/site/zoneCta';
import { ConfirmProvider } from '@/components/common/ConfirmProvider';
import { MapProvider } from '@/lib/map/MapProvider';


// Витрина дизайн-системы (TRIP-340). Вне прода и БЕЗ логина: геометрия - чистый
// CSS, поэтому визуальный гейт снимает именно её, а не рукописный стенд.
// `lazy` тут несущий, а не украшение: без него витрина уехала бы в прод-бандл
// мёртвым весом, хотя роута там нет. Провайдеры (тема, i18n, Toaster) уже стоят
// выше в App - ветка возвращается изнутри AuthenticatedApp, как /public/trip и
// /join, то есть до аут-гейта, но внутри провайдеров.
const Kit = lazy(() => import('@/pages/Kit'));

// Demo trip (TRIP-462) — a public marketing showcase page. Lazy so its weight
// (MapView + the showcase sections) never lands in the main bundle for the far
// more common routes. Its own branch below sits BEFORE the auth gate, like
// /public/trip and /join, so a logged-out visitor gets the demo (not the
// catch-all landing) and a logged-in one doesn't 404.
const DemoTrip = lazy(() => import('@/pages/Demo/DemoTrip'));

// Legal pages /terms + /privacy (TRIP-465) — one viewer, the route picks the
// active tab. Lazy: the legal prose + doc chrome never weigh on the common
// routes. Its branch sits BEFORE the auth gate (like /d and /public/trip) so a
// logged-out visitor gets the document, not the catch-all landing, and a
// logged-in one doesn't 404.
const Legal = lazy(() => import('@/pages/Legal'));

// ★ ОБОЛОЧКА АВТОРИЗОВАННОГО ПРИЛОЖЕНИЯ — ОТДЕЛЬНЫМ ЧАНКОМ (TRIP-475).
// Провайдеры продукта и таблица его маршрутов уехали в `AuthenticatedShell`:
// анониму они не показываются никогда, а платил за них байтами каждый, кто
// открыл лендинг. Граница ОДНА, дерево залогиненного не тронуто — подробности
// в докблоке самого файла.
const AuthenticatedShell = lazy(() => import('./AuthenticatedShell'));

// ★ ТРИ ПУБЛИЧНЫХ ЭКРАНА — ТОЖЕ LAZY (TRIP-475 шаг 2). Они остались СТАТИЧЕСКИМИ,
// когда TRIP-445 переводил экраны на `lazy`, и это стоило дорого: их код лежал в
// ГЛАВНОМ чанке, то есть его качал КАЖДЫЙ, кто открыл лендинг, — включая того,
// кто никогда не откроет чужой публичный трип и не пойдёт логиниться. Замер по
// карте исходников: 95 366 байт главного чанка, из них тяжёлое — цепочка
// `PublicTrip → MapView` (кластеризация точек, разметка маркеров и линий) и
// `Login` (24 КБ).
//
// Карту у публичного трипа НИКТО не забирает: `lazy` не меняет, что грузится на
// экране, — он меняет, В КАКОМ ФАЙЛЕ это лежит. Открыл `/public/trip/:id` →
// чанк приехал, карта на месте. Открыл только лендинг → чанк не приехал вовсе.
const PublicTrip = lazy(() => import('@/pages/PublicTrip'));
const JoinTrip = lazy(() => import('@/pages/JoinTrip'));
const Login = lazy(() => import('@/pages/Login'));

// ★ РУЧНОЙ ПЛАНИРОВЩИК — ЕДИНСТВЕННЫЙ ЭКРАН ПРИЛОЖЕНИЯ, ОТКРЫТЫЙ БЕЗ СЕССИИ
// (TRIP-505). Тот же модуль, что грузит `AuthenticatedShell`, — vite отдаёт им
// ОДИН чанк, поэтому второго объявления `lazy` дубля в бандл не добавляет.
//
// `lazy` тут несущий, как у витрины и демо: без него планировщик (карта Mapbox,
// композер города, справочник) лёг бы в главный чанк, то есть его качал бы
// каждый, кто открыл лендинг, — ровно та граница, которую поставил TRIP-475.
// С `lazy` чанк приезжает по клику на CTA и ни секундой раньше.
const GuestPlanner = lazy(() => import('@/pages/ManualPlanner'));

// Per-screen open events (TRIP-213 Ф2b). There is NO generic page_view — native
// $pageview is off (main.jsx) and the routes that already have a dedicated event
// (/trip/:id → trip_opened, /pro → pricing_viewed, /public/trip → public_trip_viewed,
// а планировщик — /new-trip, /plan и /plan-trip-ai — шлёт trip_creation_started
// сам, из экрана, а не по маршруту) send NOTHING here, so we don't
// double-bill the free-tier quota. Only screens WITHOUT their own event get one.
// Returns null → no event for this route.
function screenOpenEvent(pathname, search) {
  if (pathname === '/') return { event: 'landing_viewed' };
  // `view` — КАКУЮ ИЗ ФОРМ человек увидел, а не только «дошёл до входа». Экран
  // входа несёт вход, регистрацию и восстановление, и без этого поля «увидел
  // форму регистрации» неотличимо от «увидел форму входа»: строка события у них
  // одна, то есть у самой верхней ступени регистрационной воронки нет числа.
  // Свойство у существующего события, а не второе событие: квота free-tier
  // считает события, а не поля.
  if (pathname === '/login' || pathname === '/reset-password') {
    return { event: 'login_opened', props: { view: initialAuthView(pathname, search) } };
  }
  if (pathname === '/trips') return { event: 'home_opened' };
  if (pathname === '/stats') return { event: 'stats_opened' };
  if (pathname === '/settings') return { event: 'account_opened' };
  if (pathname === '/inbox') return { event: 'inbox_opened' };
  if (pathname.startsWith('/d/')) return { event: 'demo_viewed' };
  if (pathname === '/terms' || pathname === '/privacy') return { event: 'legal_viewed', props: { doc: pathname === '/terms' ? 'terms' : 'privacy' } };
  return null;
}

/**
 * Адрес приложения, открытый без сессии → вход, и после входа человек попадает
 * ТУДА, КУДА ШЁЛ (TRIP-497).
 *
 * Механизм не новый: адрес кладётся в тот же `sessionStorage`, из которого его
 * читает `Login` (`postLoginPath()`), — им же с Ф3 живут ссылки-приглашения.
 * Здесь только второй писатель.
 *
 * ★ ЗАПИСЬ В РЕНДЕРЕ, А НЕ В ЭФФЕКТЕ, И ЭТО НАМЕРЕННО. `<Navigate>` уходит на
 * `/login` своим эффектом, а эффекты ребёнка выполняются РАНЬШЕ родительских —
 * то есть из эффекта мы бы записали адрес уже после того, как `Login`
 * смонтировался и прочитал хранилище, и возврат молча терялся бы. Запись
 * идемпотентна и без уборки, поэтому повтор в StrictMode безвреден.
 *
 * Адрес входа — общая дверь зоны `zoneLogin()`: метка кампании обязана ехать В
 * АДРЕСЕ, иначе она теряется на первой же перезагрузке документа — а вход
 * именно ею и заканчивается, уходя к провайдеру OAuth (TRIP-329/493). Дверь
 * названа один раз в `zoneCta.js`; здесь она была третьей копией одной строки.
 */
function RedirectToLogin() {
  const { pathname, search } = useLocation();
  rememberPostLogin(pathname + search);
  return <Navigate to={zoneLogin()} replace />;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated } = useAuth();
  const { dictFull } = useI18n();
  const location = useLocation();

  // Fire the screen-open event on SPA navigation. Fires before the auth/route
  // branches below (hooks run unconditionally).
  useEffect(() => {
    // Строка запроса читается из `window`, а НЕ из `location.search`: она не
    // должна быть зависимостью эффекта. Экран входа чистит адрес от отказа
    // OAuth через `history.replaceState` — попади `search` в зависимости, эта
    // чистка стреляла бы вторым `login_opened` на том же открытии экрана.
    const s = screenOpenEvent(location.pathname, window.location.search);
    if (s) track(s.event, s.props);
  }, [location.pathname]);

  // Экран запуска (TRIP-478): приложение отчитывается о готовности ОДИН раз,
  // при первом кадре. Само снятие откладывается, пока на экране висит
  // <AppLoading> — он держит splash сам (см. `src/lib/splash.js`), поэтому
  // перечислять здесь ожидания (авторизация, словарь, Suspense) не нужно и
  // нельзя: такой список — второй источник правды, который разъедется с
  // ветками ниже.
  useEffect(() => { hideSplash(); }, []);

  // Хвостовой слэш адреса не меняет: `react-router` терпит его сам, а рукописные
  // сверки ниже (`=== GUEST_PLANNER_PATH`, `isZoneRoute`) — нет, и `/plan/`
  // проваливался мимо ВСЕХ веток в 404-тело при статусе 200. Нормализация одна
  // и общая с краем (`isKnownPath`), иначе они разъедутся молча.
  const path = canonicalPath(location.pathname);

  // Витрина: только вне прода. На проде роута нет вовсе - путь провалится в
  // общую маршрутизацию ниже и отдаст лендинг/404, как любой чужой адрес.
  // Object-based IA (TRIP-344): `/kit` — индекс, `/kit/:object` — один объект.
  if (!isProdHost && (path === '/kit' || path.startsWith('/kit/'))) {
    return (
      <Suspense fallback={<AppLoading silent />}>
        <Routes>
          <Route path="/kit" element={<Kit />} />
          <Route path="/kit/:object" element={<Kit />} />
        </Routes>
        {/* Витрине тостов нужен живой <Toaster>: этот бранч возвращается ДО общего
            дерева, где он смонтирован, поэтому монтируем его и здесь. */}
        <Toaster />
      </Suspense>
    );
  }

  // Public read-only trip page - no auth needed.
  // Страница — под <SiteZone>, как остальные шесть маршрутов зоны (TRIP-445):
  // это ТА ЖЕ зона — та же шапка, тот же site.css, тот же переключатель языка.
  // Пока эти две ветки стояли снаружи, оболочка была «одной на зону» только на
  // словах: <html lang> ставил лендинг у себя в файле, поэтому публичка и
  // приглашение оставались lang="en" на русской странице.
  //
  // ⚠️ Обёртка на МАРШРУТЕ, а не на всей ветке, и это замер, а не вкус: под
  // site.css у голого `.btn` сайтовая база (пилюля 99px, border:0, padding
  // 13/24), а PageNotFound собран из <Btn> app-ДС — 404 приезжал бы кнопкой из
  // двух дизайн-систем (замерено: 13px 24px/99px/0 вместо 0 15px/10px/1px).
  // 404 — не страница зоны: ни шапки, ни подвала, ни её ДС ему не нужно.
  //
  // <Suspense> стоит ВНУТРИ <SiteZone>, на том же маршруте, и по той же причине,
  // что и сама обёртка: 404 не должен ни ждать чанк зоны, ни рисоваться её ДС.
  // Ожидание МОЛЧАЛИВОЕ (`silent`), как у остальных страниц зоны: до приезда
  // site.css зона не рисует ничего, и видимый спиннер здесь дал бы вспышку
  // чужого облика (в приложении наоборот — там ожидание видимое).
  if (path.startsWith('/public/trip/')) {
    return (
      <Routes>
        <Route
          path="/public/trip/:tripId"
          element={<SiteZone><Suspense fallback={<AppLoading silent />}><PublicTrip /></Suspense></SiteZone>}
        />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Invite links — handled before the auth gate. JoinTrip itself decides whether
  // to redeem the token (logged in) or bounce to /login (logged out).
  if (path.startsWith('/join/')) {
    return (
      <Routes>
        <Route
          path="/join/:token"
          element={<SiteZone><Suspense fallback={<AppLoading silent />}><JoinTrip /></Suspense></SiteZone>}
        />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // ★ ОДНА ДВЕРЬ В НЕАВТОРИЗОВАННУЮ ЗОНУ (TRIP-445).
  //
  // Лендинг, демо, /terms, /privacy и вход раньше жили пятью отдельными
  // ветками, каждая со своим <Suspense> и своим владельцем site.css. Из-за
  // этого ЛЮБОЙ переход внутри зоны размонтировал владельца слоя: стили зоны
  // снимались с документа, страницы (`if (!cssReady) return null`) на кадр
  // отдавали пустоту — это и читалось как «перезагрузка страницы». Плюс
  // прокрутка не сбрасывалась: /terms открывался с середины.
  //
  // Теперь ветка одна и оболочка <SiteZone> над маршрутами: внутри зоны она не
  // размонтируется, поэтому слой стилей стоит на месте, а меняется только
  // содержимое. Ветки страниц стоят ДО аут-гейта — демо, юр-страницы и вход
  // доступны и разлогиненному, и залогиненному.
  //
  // ★ «/» ТЕПЕРЬ ЗОНА БЕЗУСЛОВНО. Условие было `!isAuthenticated &&
  // !isLoadingAuth`, «чтобы вернувшийся из OAuth не видел вспышки лендинга», и
  // ценой этого лендинг ЖДАЛ ОТВЕТА про авторизацию, чтобы нарисоваться. Он ей
  // не пользуется: ни `LandingPage`, ни `SiteChrome`, ни `SiteTrip` не читают
  // `useAuth` — проверено грепом. То есть маркетинговая страница ждала ответа
  // на вопрос, который сама не задаёт, и посетитель без единого визита в жизни
  // смотрел на спиннер.
  //
  // Вспышка при этом не возвращается, а исчезает: она была не «зона показалась
  // рано», а СМЕНА ВЛАДЕЛЬЦА — залогиненному «/» рисовала таблица приложения
  // (ниже), и лендинг перемонтировался, теряя reveal-анимации. Теперь владелец
  // ОДИН на оба состояния, поэтому перемонтирования нет вовсе, а маршрут «/» из
  // таблицы приложения убран как недостижимый. OAuth сюда и не возвращается:
  // `redirectTo` — `postLoginPath()`, то есть `/trips` либо сохранённый путь.
  //
  // `Suspense` тоже один: демо и юр-страницы приезжают отдельными чанками.
  // Состав зоны — в `routePaths.js`: тот же список отвечает на вопрос «есть ли
  // по этому адресу страница» для `canonical` в `SiteZone`.
  const inZone = isZoneRoute(path);

  if (inZone) {
    return (
      <SiteZone>
        <Suspense fallback={<AppLoading silent />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            {/* /reset-password приходит из письма восстановления: его токен
                создаёт сессию, поэтому экран тот же, что и вход. */}
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<Login />} />
            {/* ТОЧНЫЙ адрес, а не `/d/:slug`: демо ровно одно, и чужой слаг
                обязан отдать 404, а не то же демо под любым адресом. */}
            <Route path={DEMO_PATH} element={<DemoTrip />} />
            <Route path="/terms" element={<Legal doc="terms" />} />
            <Route path="/privacy" element={<Legal doc="privacy" />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </SiteZone>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return <AppLoading />;
  }

  // ★ ГОСТЕВОЙ ПЛАНИРОВЩИК — ОДИН ЭКРАН ПРИЛОЖЕНИЯ БЕЗ СЕССИИ (TRIP-505).
  //
  // Маркетинговый вход: с лендинга человек составляет маршрут, и только на
  // последнем шаге его просят войти. Экран — ТОТ ЖЕ `ManualPlanner`, что у
  // залогиненного, без единой копии: гостю просто не показывается шаг обложки
  // (`visibleSteps` в самом планировщике), поэтому ни одного вызова, требующего
  // сессии, на его пути нет.
  //
  // ★★ ЭТО ПОВЕРХНОСТЬ ЗОНЫ, СОБРАННАЯ ПРИЛОЖЕНИЕМ — `<SiteZone surface="app">`.
  // Человек не выходил из неавторизованной зоны: он пришёл с лендинга и ещё не
  // вошёл, поэтому всё, чем зона владеет, обязано остаться при нём — светлая
  // тема (у зоны нет тёмной), `<html lang>`, сброс прокрутки, слой `site.css`
  // для сайтовой шапки. Не остаётся ровно одно — ДОКУМЕНТНЫЙ слой сайтовой ДС
  // (`html.site`): страницу рисует ДС приложения, и её типографику с фоном
  // перебивать нечем. Ровно это различие и называет `surface` (разбор — в
  // `SiteZone`), а держит его расщепление `site.css` на документный и
  // компонентный слои: компонентный весь описан от `:where(.site)` и потому
  // достаёт только до острова шапки, а не до экрана.
  //
  // ★★★ ВЕТКА СТОИТ ПОСЛЕ ГЕЙТА ЗАГРУЗКИ, И ЭТО НЕСУЩЕЕ. `isAuthenticated`
  // ложна не только у гостя, но и у ВОЗВРАЩАЮЩЕГОСЯ из OAuth, пока сессия ещё
  // едет. Отрисуй мы гостевой вариант в это окно — планировщик записал бы
  // черновик под ключ `guest` уже после того, как человек вошёл, и черновик
  // разъехался бы сам с собой (ключ хранилища — по `user.id`, см.
  // `lib/plannerDraft.js`).
  //
  // Вошедшему здесь делать нечего: у планировщика есть адрес приложения, и
  // поверхность там своя (тема человека, шапка приложения, никакого `noindex`).
  // Перенос один и `replace` — чтобы «назад» не возвращало в редирект.
  if (path === GUEST_PLANNER_PATH) {
    if (isAuthenticated) return <Navigate to={PLANNER_PATH} replace />;
    return (
      <SiteZone surface="app">
        <Suspense fallback={<AppLoading silent />}>
          <GuestPlanner />
        </Suspense>
      </SiteZone>
    );
  }

  // Без сессии и вне зоны. Оболочка и <Suspense> ТЕ ЖЕ, что в ветке зоны выше,
  // и это несущее: React сверяет по типу элемента, поэтому переход «чужой адрес
  // → /terms» не пересоздаёт ни <SiteZone>, ни <Suspense> — слой стилей зоны не
  // роняется. Разойдись эти две обёртки по составу, и первый же lazy-маршрут,
  // добавленный сюда, вернул бы пустой кадр, который вся эта ветка и убирает.
  //
  // ★ ЗДЕСЬ СХОДИЛИСЬ ДВА РАЗНЫХ СЛУЧАЯ, И ОБА ОТДАВАЛИ ЛЕНДИНГ (TRIP-497):
  //   · `/trip/<id>` из письма, открытый без сессии, — страница ЕСТЬ, человеку
  //     нужен вход; лендинг вместо входа терял его по дороге к своей поездке;
  //   · Любой другой набор букв — страницы НЕТ, и лендинг под этим адресом отвечал
  //     краулеру «200, вот содержимое», да ещё и с `canonical` на самого себя,
  //     то есть каждая битая ссылка на нас становилась отдельной «страницей».
  // Различает их таблица маршрутов приложения: совпал шаблон — вход с
  // возвратом, не совпал — 404. Сопоставление делает сам react-router, второго
  // матчера здесь нет.
  if (!isAuthenticated) {
    return (
      <SiteZone>
        <Suspense fallback={<AppLoading silent />}>
          <Routes>
            {/* Планировщик `/new-trip` остаётся ЗДЕСЬ, среди адресов приложения:
                без сессии он ведёт во вход с возвратом, как и был. Экран без
                сессии живёт на своём адресе `/plan` (разбор — `routePaths.js`),
                и его ветка стоит выше, до сюда не доходя. */}
            {APP_ROUTES.map((pattern) => (
              <Route key={pattern} path={pattern} element={<RedirectToLogin />} />
            ))}
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </SiteZone>
    );
  }

  // ★ Экраны приложения ждут ПОЛНОГО словаря, зона — нет. Готовность языка
  // раньше значила «все 48 словарей загружены», и это ждал КАЖДЫЙ первый кадр,
  // включая лендинг, которому нужно шесть (`i18n/zoneNamespaces.js`). Теперь
  // провайдер отпускает первый кадр после зонного набора, а остальные 42
  // догружает фоном — и ждать их обязано ровно то, что ими пользуется. Гейт
  // стоит ЗДЕСЬ, а не в общем ожидании выше: ветки зоны возвращаются раньше
  // него, поэтому лендинг, вход, демо, юр-страницы, join и публичка не ждут.
  if (!dictFull) {
    return <AppLoading />;
  }

  // Всё, что видит ТОЛЬКО залогиненный, живёт отдельным чанком: провайдеры
  // продукта и таблица его маршрутов. Ожидание — тот же <AppLoading>, что и у
  // гейта авторизации выше, поэтому для человека ничего не меняется: он и так
  // смотрел на него, пока проверялась авторизация.
  return (
    <Suspense fallback={<AppLoading />}>
      <AuthenticatedShell />
    </Suspense>
  );
};

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <I18nProvider>
            <QueryClientProvider client={queryClientInstance}>
              <ConfirmProvider>
                {/* One Mapbox instance for the whole app, above the router so it
                    survives route changes (overview ↔ map ↔ editor ↔ planner ↔
                    create ↔ different trip). Lazy: non-map routes pay nothing. */}
                <MapProvider>
                  <Router>
                    <AuthenticatedApp />
                  </Router>
                  <Toaster />
                  {/* Outside <Router> on purpose: the panel must appear on EVERY
                      entry, including the anonymous public-trip and invite links
                      that never reach an authenticated route (TRIP-311). */}
                  <ConsentBanner />
                  {/* Vercel Web Analytics — SPA pageview tracking (auto-tracks
                      react-router navigations via the History API). Cookieless:
                      it writes nothing to the device, so it counts visits for
                      everyone, including people who refuse PostHog. Declared in
                      the privacy policy under legitimate interest. */}
                  <Analytics />
                </MapProvider>
              </ConfirmProvider>
            </QueryClientProvider>
          </I18nProvider>
        </ThemeProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}

export default App