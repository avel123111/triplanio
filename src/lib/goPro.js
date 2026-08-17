// @ts-check
// Единственный источник навигации на страницу апгрейда /pro.
//
// Семь рукописных nav('/pro?...') (EventEditDialog · TripLimitDialog · SettingsLens ·
// ScreenAccount · TripView · Trips · ManualPlanner) различались ТОЛЬКО query-параметрами —
// сборка строки собрана здесь. ProUpsellProvider (TRIP-225) дедуплил МОДАЛКУ, а не
// навигацию; эти call-sites — прямой переход на /pro, не апселл-модаль.
//
// Страница /pro (src/pages/Pro.jsx) читает параметры через searchParams и трактует
// пустое и отсутствующее одинаково: `get('tripId') || null`, `get('from') || null`,
// `hidePerTrip === '1'`. Поэтому опускание falsy-значений даёт поведение 1:1 с прежними
// строками (`tripId=` пустой ≡ отсутствие tripId).

/**
 * @param {(to: string) => void} nav  navigate из react-router (useNavigate())
 * @param {{ tripId?: string|null, hidePerTrip?: boolean, from?: string, feature?: string }} [opts]
 */
export function goPro(nav, { tripId, hidePerTrip, from, feature } = {}) {
  const qs = new URLSearchParams();
  if (tripId) qs.set('tripId', tripId);
  if (hidePerTrip) qs.set('hidePerTrip', '1');
  if (from) qs.set('from', from);
  if (feature) qs.set('feature', feature);
  const s = qs.toString();
  nav(s ? `/pro?${s}` : '/pro');
}
