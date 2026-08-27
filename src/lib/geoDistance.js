// Расстояние между двумя точками — ЛИСТ без единого импорта.
//
// Функция жила в `trip-stats.js`, но тот тянет `@/lib/trip-cities` через алиас, а
// `stay22-normalize.js` обязан грузиться голым `node --test` (алиасы там не
// резолвятся). Вместо четвёртой копии формулы — один дом, из которого её берут
// оба: `trip-stats.js` ре-экспортирует её дальше, чтобы существующие импортёры
// (`ManualPlanner.jsx`) не заметили переезда.
//
// ⚠ В репозитории ЕЩЁ ДВЕ копии того же haversine — `src/components/views/MapView.jsx`
// и `src/lib/routing.js`. Они не тронуты (другая задача, другой риск), но дом для
// схлопывания теперь есть.

/** Great-circle distance between two [lat, lng] points, in km (haversine). */
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371; // mean Earth radius, km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
