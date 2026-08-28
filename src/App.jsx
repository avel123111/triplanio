import { lazy, Suspense, useEffect } from 'react'
import { Toaster } from "@/design/index"
import { track } from '@/lib/analytics'
import { isProdHost } from '@/lib/analyticsEnv'
import { Analytics } from '@vercel/analytics/react'
import ConsentBanner from '@/components/ConsentBanner'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import ErrorBoundary from '@/components/ErrorBoundary';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider } from '@/lib/i18n/I18nContext';
import { AppLoading } from '@/design/index';
import PublicTrip from '@/pages/PublicTrip';
import JoinTrip from '@/pages/JoinTrip';
import Login from '@/pages/Login';
import LandingPage from '@/pages/Landing/LandingPage';
import { SiteZone } from '@/components/site/SiteChrome';
import { DEMO_PATH } from '@/pages/Demo/demoPath';
import StripeReturnModals from '@/components/common/StripeReturnModals';
import { ConfirmProvider } from '@/components/common/ConfirmProvider';
import { MapProvider } from '@/lib/map/MapProvider';
import MobileBottomNav, { MobileNavProvider } from '@/components/MobileBottomNav';
import { CreateTripProvider } from '@/components/create/CreateTripProvider';
import { FeedbackProvider } from '@/components/support/FeedbackProvider';
import { ProUpsellProvider } from '@/components/common/ProUpsellProvider';

// ★ ЭКРАНЫ ПРИЛОЖЕНИЯ — LAZY (TRIP-445). Семь статических импортов держали весь
// авторизованный продукт в ГЛАВНОМ чанке, поэтому лендинг, вход и юр-страницы
// скачивали планировщик, редактор поездки и статистику вместе с их зависимостями
// — притом что незалогиненный посетитель не откроет ни один из них. Техника не
// новая: Kit / DemoTrip / Legal уже приезжают так же.
// `MapProvider` при этом остаётся статическим и держит `mapbox-gl` синхронным —
// сам по себе этот `lazy` полмегабайта карты не снимает, см. vite.config.js.
const Trips = lazy(() => import('@/pages/Trips'));
const Statistics = lazy(() => import('@/pages/Statistics'));
const TripView = lazy(() => import('@/pages/TripView'));
const ScreenAccount = lazy(() => import('@/pages/ScreenAccount'));
const ManualPlanner = lazy(() => import('@/pages/ManualPlanner'));
const Inbox = lazy(() => import('@/pages/Inbox'));
const Pro = lazy(() => import('@/pages/Pro'));

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

// Per-screen open events (TRIP-213 Ф2b). There is NO generic page_view — native
// $pageview is off (main.jsx) and the routes that already have a dedicated event
// (/trip/:id → trip_opened, /pro → pricing_viewed, /public/trip → public_trip_viewed,
// /new-trip|/plan-trip-ai → trip_creation_started) send NOTHING here, so we don't
// double-bill the free-tier quota. Only screens WITHOUT their own event get one.
// Returns null → no event for this route.
function screenOpenEvent(pathname) {
  if (pathname === '/') return { event: 'landing_viewed' };
  if (pathname === '/login' || pathname === '/reset-password') return { event: 'login_opened' };
  if (pathname === '/trips') return { event: 'home_opened' };
  if (pathname === '/stats') return { event: 'stats_opened' };
  if (pathname === '/settings') return { event: 'account_opened' };
  if (pathname === '/inbox') return { event: 'inbox_opened' };
  if (pathname.startsWith('/d/')) return { event: 'demo_viewed' };
  if (pathname === '/terms' || pathname === '/privacy') return { event: 'legal_viewed', props: { doc: pathname === '/terms' ? 'terms' : 'privacy' } };
  return null;
}

// Старый адрес редактора → секция того же трипа. Событие `route_opened` отсюда
// УБРАНО намеренно: оно переехало на саму секцию (реестр секций), то есть теперь
// считается и при переходе из меню, а не только при заходе по адресу.
//
// Целится в 'route': редактор и линза карты схлопнуты в один экран «Маршрут»
// (TRIP-459). Сам `?lens=edit` из чужих закладок тоже жив — его разворачивает
// карта легаси-имён в реестре секций.
function RedirectToEditSection() {
  const { tripId } = useParams();
  return <Navigate to={`/trip/${tripId}?lens=route`} replace />;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated } = useAuth();
  const location = useLocation();

  // Fire the screen-open event on SPA navigation. Fires before the auth/route
  // branches below (hooks run unconditionally).
  useEffect(() => {
    const s = screenOpenEvent(location.pathname);
    if (s) track(s.event, s.props);
  }, [location.pathname]);

  const path = location.pathname;

  // Витрина: только вне прода. На проде роута нет вовсе - путь провалится в
  // общую маршрутизацию ниже и отдаст лендинг/404, как любой чужой адрес.
  // Object-based IA (TRIP-344): `/kit` — индекс, `/kit/:object` — один объект.
  if (!isProdHost && (path === '/kit' || path.startsWith('/kit/'))) {
    return (
      <Suspense fallback={null}>
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
  // <Suspense> и lazy тут не нужны — обе страницы в главном чанке.
  if (path.startsWith('/public/trip/')) {
    return (
      <Routes>
        <Route path="/public/trip/:tripId" element={<SiteZone><PublicTrip /></SiteZone>} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  // Invite links — handled before the auth gate. JoinTrip itself decides whether
  // to redeem the token (logged in) or bounce to /login (logged out).
  if (path.startsWith('/join/')) {
    return (
      <Routes>
        <Route path="/join/:token" element={<SiteZone><JoinTrip /></SiteZone>} />
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
  // содержимое. Ветки страниц остались ДО аут-гейта (демо, юр-страницы и вход
  // доступны и разлогиненному, и залогиненному), условие на «/» — прежнее:
  // лендинг показываем только после того, как авторизация РАЗРЕШЕНА, иначе
  // вернувшийся из OAuth видит вспышку лендинга.
  //
  // `Suspense` тоже один: демо и юр-страницы приезжают отдельными чанками.
  const inZone = path.startsWith('/d/')
    || path === '/terms' || path === '/privacy'
    || path === '/login' || path === '/reset-password'
    || (path === '/' && !isAuthenticated && !isLoadingAuth);

  if (inZone) {
    return (
      <SiteZone>
        <Suspense fallback={null}>
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

  // Not authenticated and on a non-root path - send to landing. Оболочка и
  // <Suspense> ТЕ ЖЕ, что в ветке зоны выше, и это несущее: React сверяет по
  // типу элемента, поэтому переход «чужой адрес → /terms» не пересоздаёт ни
  // <SiteZone>, ни <Suspense> — слой стилей зоны не роняется. Разойдись эти
  // две обёртки по составу, и первый же lazy-маршрут, добавленный сюда,
  // вернул бы пустой кадр, который вся эта ветка и убирает.
  if (!isAuthenticated) {
    return (
      <SiteZone>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="*" element={<LandingPage />} />
          </Routes>
        </Suspense>
      </SiteZone>
    );
  }

  return (
    <MobileNavProvider>
     <CreateTripProvider>
      <ProUpsellProvider>
      <FeedbackProvider>
      {/* One global Stripe-return handler for the whole logged-in app - shows the
          success/fail modal regardless of which screen Stripe came back to. */}
      <StripeReturnModals />
      {/* Route-level crash isolation (TRIP-219 F2): a render crash in one screen
          shows an in-place retry fallback instead of white-screening the whole
          app; the global bottom-nav (sibling) stays alive. Keyed by pathname so
          navigating away resets a crashed route. */}
      <ErrorBoundary key={path} region={`route:${path}`}>
      {/* Экраны приезжают отдельными чанками, поэтому нужен видимый ожидатель —
          ТОТ ЖЕ, что у гейта авторизации выше: ожидание выглядит одинаково,
          откуда бы ни пришло. `fallback={null}` тут не годится (в зоне он
          уместен: страницы сами гейтят по cssReady), здесь дал бы белый кадр. */}
      <Suspense fallback={<AppLoading />}>
      <Routes>
      {/* New design - standalone (own app-header, no Layout) */}
      {/* Logged-in users can still view the landing at "/" (no auto-redirect);
          the landing's CTA takes them into the app. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/trips" element={<Trips />} />
      <Route path="/stats" element={<Statistics />} />
      <Route path="/new-trip" element={<ManualPlanner />} />
      <Route path="/trip/:tripId" element={<TripView />} />
      {/* TRIP-349: редактор стал секцией (сегодня ?lens=route). Роут оставлен РЕДИРЕКТОМ -
          по нему живут закладки, история браузера и ссылки в уже отправленных
          письмах; replace, чтобы «назад» не возвращало в редирект. */}
      <Route path="/trip/:tripId/edit" element={<RedirectToEditSection />} />
      <Route path="/settings" element={<ScreenAccount />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/pro" element={<Pro />} />

      <Route path="/plan-trip-ai" element={<ManualPlanner initialMethod="ai" />} />

      <Route path="*" element={<PageNotFound />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
      {/* Custom mobile bottom nav (≤640px); hides itself on planner / create /
          landing / login routes. */}
      <MobileBottomNav />
      </FeedbackProvider>
      </ProUpsellProvider>
     </CreateTripProvider>
    </MobileNavProvider>
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