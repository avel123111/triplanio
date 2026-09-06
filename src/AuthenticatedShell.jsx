import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppLoading } from '@/design/index';
import ErrorBoundary from '@/components/ErrorBoundary';
import PageNotFound from '@/lib/PageNotFound';
import StripeReturnModals from '@/components/common/StripeReturnModals';
import MobileBottomNav, { MobileNavProvider } from '@/components/MobileBottomNav';
import { CreateTripProvider } from '@/components/create/CreateTripProvider';
import { FeedbackProvider } from '@/components/support/FeedbackProvider';
import { ProUpsellProvider } from '@/components/common/ProUpsellProvider';

/* =========================================================
   ★ ОБОЛОЧКА АВТОРИЗОВАННОГО ПРИЛОЖЕНИЯ — ОТДЕЛЬНЫМ ЧАНКОМ (TRIP-475).

   ЗАЧЕМ. Провайдеры продукта (нижняя навигация, создание поездки, апселл Pro,
   обратная связь, возврат из Stripe) и таблица маршрутов приложения лежали в
   ГЛАВНОМ чанке — том, который качает КАЖДЫЙ, кто открыл лендинг. Аноним не
   увидит ни одного из них, но платил за них байтами.

   ★ ГРАНИЦА ОДНА, А НЕ ОДИННАДЦАТЬ ПРАВОК. Дерево, которое видит залогиненный,
   осталось БАЙТ В БАЙТ прежним: тот же порядок провайдеров, тот же
   ErrorBoundary с key={path}, тот же Suspense над маршрутами, тот же
   MobileBottomNav соседом. Двигали не дерево, а то, в каком ФАЙЛЕ оно лежит —
   поэтому одиннадцати шансов уронить оплату и создание поездки здесь нет.

   Резать по этой границе естественно: публичные ветки (`inZone`, витрина,
   /public/trip, /join, неавторизованный лендинг) возвращаются в `App.jsx` ДО
   аут-гейта и этой оболочки не касаются вовсе.

   `path` берём своим `useLocation()`, а не пропом: хук уже есть у вызывателя,
   но проп сделал бы два источника одного и того же адреса.
========================================================= */

// ★ Экраны приложения — LAZY (TRIP-445). Список переехал сюда вместе с
// маршрутами, которые его используют: держать `lazy()` в `App.jsx`, когда сами
// <Route> живут здесь, значило бы разложить одну вещь по двум файлам.
const Trips = lazy(() => import('@/pages/Trips'));
const Statistics = lazy(() => import('@/pages/Statistics'));
const TripView = lazy(() => import('@/pages/TripView'));
const ScreenAccount = lazy(() => import('@/pages/ScreenAccount'));
const ManualPlanner = lazy(() => import('@/pages/ManualPlanner'));
const Inbox = lazy(() => import('@/pages/Inbox'));
const Pro = lazy(() => import('@/pages/Pro'));

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

export default function AuthenticatedShell() {
  const path = useLocation().pathname;

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
      {/* Экраны приезжают отдельными чанками, поэтому нужен ВИДИМЫЙ ожидатель —
          ТОТ ЖЕ, что у гейта авторизации выше: ожидание выглядит одинаково,
          откуда бы ни пришло. Молчаливый (`silent`, как в зоне) здесь дал бы
          белый кадр: приложение уже на экране, и человеку надо сказать, что
          оно занято. В зоне наоборот — там своя ДС и до приезда site.css
          страница не рисует ничего, поэтому ожидание молчит; заставку оба
          облика держат одинаково (TRIP-478). */}
      <Suspense fallback={<AppLoading />}>
      <Routes>
      {/* New design - standalone (own app-header, no Layout) */}
      {/* «/» здесь больше нет: лендинг — страница ЗОНЫ в обоих состояниях
          авторизации, и владелец у него один (ветка `inZone` выше). Пока
          маршрут был и там, и тут, залогиненному лендинг перемонтировался при
          получении ответа про авторизацию. */}
      <Route path="/trips" element={<Trips />} />
      <Route path="/stats" element={<Statistics />} />
      <Route path="/new-trip" element={<ManualPlanner key="manual" />} />
      <Route path="/trip/:tripId" element={<TripView />} />
      {/* TRIP-349: редактор стал секцией (сегодня ?lens=route). Роут оставлен РЕДИРЕКТОМ -
          по нему живут закладки, история браузера и ссылки в уже отправленных
          письмах; replace, чтобы «назад» не возвращало в редирект. */}
      <Route path="/trip/:tripId/edit" element={<RedirectToEditSection />} />
      <Route path="/settings" element={<ScreenAccount />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/pro" element={<Pro />} />

      {/* `key` на обеих дверях: без него React переиспользует ТОТ ЖЕ экземпляр
          `ManualPlanner` при переходе между дверями (тип элемента один, меняется
          только проп), и эффект восстановления черновика — деп `user?.id` — второй
          раз не бежит. На этом стоит увод чужого черновика на его дверь. */}
      <Route path="/plan-trip-ai" element={<ManualPlanner key="ai" initialMethod="ai" />} />

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
}
