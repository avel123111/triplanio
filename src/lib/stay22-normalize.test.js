// Unit tests for Stay22 mapping + param building. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStay22, buildStay22Params, boxAround, POOL_BOX_KM, GEO_MODES, todayLocal, ensureNextDay, filterParams, applyClientFilters, BASE_HOTEL_FILTERS, STAY22_FILTER_SPEC } from './stay22-normalize.js';

const SAMPLE = {
  meta: { pageSize: 10, count: 3, page: 1, hasMore: true, total: 32, currency: 'USD', checkin: '2026-10-05', checkout: '2026-10-10', nights: 5 },
  results: [
    {
      id: '32497041.0000',
      url: 'https://www.stay22.com/allez/roam/usds_32497041.0000?aid=triplanio',
      // Multi-supplier: expedia listed first → it becomes the primary supplier.
      suppliers: {
        expedia: { id: 'e1', link: 'https://www.stay22.com/allez/expedia/e1', media: { logoSquare: 'https://r2.stay22.com/expedia.png' }, price: { total: 328 } },
        booking: { id: '15771687', link: 'https://www.stay22.com/allez/booking/15771687', media: { logoSquare: 'https://r2.stay22.com/2025_booking.png' }, price: { total: 340 } },
      },
      name: 'C&H Aravaca Garden', type: 'Accommodation',
      location: { address: 'Calle Burgohondo, 8, Madrid, 28023, Spain', coordinates: [-3.7038, 40.4168] },
      rating: { value: 7, hotelStars: 3, count: 60 },
      media: { thumbnail: 'https://example/thumb.jpg' },
    },
    {
      id: 'noreview.0000',
      url: 'https://www.stay22.com/allez/roam/noreview',
      suppliers: { booking: { id: '1', link: 'https://x', media: { logoSquare: 'l' } } }, // no price
      name: 'No Reviews Place', type: 'Accommodation',
      location: { address: 'Somewhere' }, // no coordinates
      rating: { value: 0, hotelStars: null, count: 0 },
      media: { thumbnail: '' },
    },
  ],
};

test('normalizeStay22: maps price, currency, link, rating, stars, coords (supplier-agnostic)', () => {
  const { hotels, meta } = normalizeStay22(SAMPLE);
  assert.equal(hotels.length, 2);
  const a = hotels[0];
  assert.equal(a.price, 328); // primary supplier (expedia, listed first) price
  assert.equal(a.currency, 'USD');
  assert.equal(a.supplierKey, 'expedia');
  assert.equal(a.supplierLogo, 'https://r2.stay22.com/expedia.png');
  assert.equal(a.link, 'https://www.stay22.com/allez/expedia/e1'); // supplier link, not roam url
  assert.equal(a.lat, 40.4168);
  assert.equal(a.lng, -3.7038);
  assert.equal(a.ratingValue, 7);
  assert.equal(a.ratingCount, 60);
  assert.equal(a.stars, 3);
  assert.equal(meta.total, 32);
  assert.equal(meta.nights, 5);
  assert.equal(meta.hasMore, true);
});

test('normalizeStay22: always surfaces the first supplier key (provider filter retired)', () => {
  // expedia is listed first → it is the primary supplier regardless of any arg.
  const a = normalizeStay22(SAMPLE).hotels[0];
  assert.equal(a.supplierKey, 'expedia');
  assert.equal(a.price, 328);
  assert.equal(a.link, 'https://www.stay22.com/allez/expedia/e1');
});

test('normalizeStay22: hides price/rating when absent, lat/lng null without coordinates', () => {
  const { hotels } = normalizeStay22(SAMPLE);
  const b = hotels[1];
  assert.equal(b.price, null);
  assert.equal(b.ratingValue, null);
  assert.equal(b.ratingCount, null);
  assert.equal(b.stars, null);
  assert.equal(b.supplierKey, 'booking');
  assert.equal(b.lat, null);
  assert.equal(b.lng, null);
});

test('normalizeStay22: empty/garbage input is safe', () => {
  assert.deepEqual(normalizeStay22(null).hotels, []);
  assert.deepEqual(normalizeStay22({ results: 'nope' }).hotels, []);
});

test('buildStay22Params: builds from coords, never sends rooms, page defaults to 1', () => {
  const visit = { id: 'c1', latitude: 40.41, longitude: -3.7, start_date: '2026-10-05', end_date: '2026-10-10' };
  // `today` пинуем явно: без него тест начал бы падать сам собой 2026-10-05,
  // когда его же даты уедут в прошлое и сработает отсечка.
  const p = buildStay22Params({ visit, currency: 'EUR', lang: 'ru', today: '2026-10-01' });
  assert.equal(p.lat, 40.41);
  assert.equal(p.lng, -3.7);
  assert.equal(p.checkin, '2026-10-05');
  assert.equal(p.checkout, '2026-10-10');
  assert.equal(p.currency, 'EUR');
  assert.equal(p.lang, 'ru');
  assert.equal(p.page, 1);
  assert.ok(!('rooms' in p));
  assert.ok(!('adults' in p)); // adults defaulted server-side, not client
});

test('buildStay22Params: returns null without coordinates', () => {
  assert.equal(buildStay22Params({ visit: { start_date: '2026-10-05' }, currency: 'EUR' }), null);
});

// Даты в прошлом Stay22 отбивает 400-м, edge превращает его в 502, и панель
// краснеет вместо того, чтобы показать пустое состояние. Три случая границы:
test('buildStay22Params: закончившееся посещение не шлёт запрос вовсе', () => {
  const visit = { id: 'c1', latitude: 40.41, longitude: -3.7, start_date: '2026-08-20', end_date: '2026-08-24' };
  assert.equal(buildStay22Params({ visit, currency: 'EUR', today: '2026-08-26' }), null);
});

test('buildStay22Params: посещение, кончающееся СЕГОДНЯ, тоже не шлёт (ночь уже не забронировать)', () => {
  const visit = { id: 'c1', latitude: 40.41, longitude: -3.7, start_date: '2026-08-24', end_date: '2026-08-26' };
  assert.equal(buildStay22Params({ visit, currency: 'EUR', today: '2026-08-26' }), null);
});

test('buildStay22Params: идущее посещение поднимает checkin до сегодня, checkout не трогает', () => {
  const visit = { id: 'c1', latitude: 40.41, longitude: -3.7, start_date: '2026-08-24', end_date: '2026-08-30' };
  const p = buildStay22Params({ visit, currency: 'EUR', today: '2026-08-26' });
  assert.equal(p.checkin, '2026-08-26');
  assert.equal(p.checkout, '2026-08-30');
});

test('buildStay22Params: будущее посещение проходит нетронутым', () => {
  const visit = { id: 'c1', latitude: 40.41, longitude: -3.7, start_date: '2026-09-02', end_date: '2026-09-06' };
  const p = buildStay22Params({ visit, currency: 'EUR', today: '2026-08-26' });
  assert.equal(p.checkin, '2026-09-02');
  assert.equal(p.checkout, '2026-09-06');
});

test('todayLocal: локальный календарь, не UTC (иначе западнее Гринвича теряется ночь)', () => {
  // 1 марта 00:30 по локальному времени — в UTC это ещё 28 февраля для UTC-, но
  // гостю нужен ЕГО день.
  assert.equal(todayLocal(new Date(2026, 2, 1, 0, 30)), '2026-03-01');
  assert.equal(todayLocal(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('ensureNextDay: forces checkout strictly after checkin', () => {
  assert.equal(ensureNextDay('2026-10-05', '2026-10-05'), '2026-10-06');
  assert.equal(ensureNextDay('2026-10-05', ''), '2026-10-06');
  assert.equal(ensureNextDay('2026-10-05', '2026-10-10'), '2026-10-10');
});

// Pool merging (dedup / progressive pages / cap+truncated) is the shared
// mergeById — covered once in forkPool.test.js instead of once per list.

test('filterParams: passes guests only, never provider or price (client-side now)', () => {
  // provider is dropped even if present — the platform filter was retired on the FE.
  assert.deepEqual(filterParams({ adults: 3, children: 1, rooms: 2, provider: 'booking' }), { adults: 3, children: 1, rooms: 2 });
  assert.deepEqual(filterParams({ adults: 0, min: 50, max: 100 }), {}); // price is NOT a server param
  assert.deepEqual(filterParams(null), {});
});

const HOTELS = [
  { id: 'a', name: 'Grand Plaza', address: 'Centro, Madrid', price: 300, ratingValue: 8.5 },
  { id: 'b', name: 'Budget Inn', address: 'Airport road', price: 90, ratingValue: 7.1 },
  { id: 'c', name: 'Sea View', address: 'Playa, Madrid', price: null, ratingValue: 9.2 },
];

test('applyClientFilters: text spans name + address, case-insensitive', () => {
  assert.deepEqual(applyClientFilters(HOTELS, { text: 'madrid' }).map((h) => h.id), ['a', 'c']);
  assert.deepEqual(applyClientFilters(HOTELS, { text: 'budget' }).map((h) => h.id), ['b']);
});

test('applyClientFilters: price bounds in trip currency; null-price hidden while filtering', () => {
  assert.deepEqual(applyClientFilters(HOTELS, { max: 100 }).map((h) => h.id), ['b']);
  assert.deepEqual(applyClientFilters(HOTELS, { min: 100 }).map((h) => h.id), ['a']); // 'c' has no price → hidden
  assert.deepEqual(applyClientFilters(HOTELS, {}).map((h) => h.id), ['a', 'b', 'c']); // no bound → null kept
});

test('applyClientFilters: sort price ↑ (nulls last) / rating ↓; recommended keeps order', () => {
  assert.deepEqual(applyClientFilters(HOTELS, { sortBy: 'price' }).map((h) => h.id), ['b', 'a', 'c']);
  assert.deepEqual(applyClientFilters(HOTELS, { sortBy: 'rating' }).map((h) => h.id), ['c', 'a', 'b']);
  assert.deepEqual(applyClientFilters(HOTELS, { sortBy: 'recommended' }).map((h) => h.id), ['a', 'b', 'c']);
  assert.deepEqual(HOTELS.map((h) => h.id), ['a', 'b', 'c']); // input not mutated
});

// TRIP-293 (mirror of the activity-side guard in viator-filters.test.js): the
// "Сбросить" button restores BASE_HOTEL_FILTERS wholesale. A knob the list filters
// on but the base has no slot for would survive the reset and leave the button
// looking dead — which is the bug this pair of tests locks down on both lists.
test('BASE_HOTEL_FILTERS carries a cleared slot for every knob the spec reads', () => {
  const knobs = ['text', 'min', 'max', 'sortBy', ...Object.keys(STAY22_FILTER_SPEC.flags || {})];
  for (const k of knobs) assert.ok(k in BASE_HOTEL_FILTERS, `missing "${k}" in BASE_HOTEL_FILTERS`);
  const active = { text: 'madrid', min: 100, max: 400, sortBy: 'price' };
  assert.ok(applyClientFilters(HOTELS, active).length < HOTELS.length, 'fixture must be filterable');
  assert.deepEqual(applyClientFilters(HOTELS, { ...active, ...BASE_HOTEL_FILTERS }).map((h) => h.id), ['a', 'b', 'c']);
});

// ── Прямоугольник: второй гео-режим (покрытие больших городов) ───────────────

test('boxAround: ±12 км вокруг точки, широта и долгота по-разному', () => {
  const b = boxAround(34.05223, -118.24368);
  // Широтный шаг постоянен: 12 / 111.32 ≈ 0.1078°.
  assert.ok(Math.abs((b.nelat - b.swlat) / 2 - 12 / 111.32) < 1e-9);
  // Долготный шире, потому что делится на cos(34°) ≈ 0.829.
  assert.ok(b.nelng - b.swlng > b.nelat - b.swlat);
  // Центр коробки — исходная точка.
  assert.ok(Math.abs((b.nelat + b.swlat) / 2 - 34.05223) < 1e-9);
  assert.ok(Math.abs((b.nelng + b.swlng) / 2 - (-118.24368)) < 1e-9);
});

test('boxAround: у полюса долгота не улетает в бесконечность', () => {
  const b = boxAround(90, 0);
  assert.ok(Number.isFinite(b.nelng) && Number.isFinite(b.swlng));
  assert.equal(b.nelng, 180);
  assert.equal(b.nelat, 90); // за полюс не вылезаем
  assert.equal(POOL_BOX_KM, 12);
});

test('buildStay22Params: режим коробки шлёт четыре угла и НЕ шлёт точку', () => {
  const visit = { id: 'c1', latitude: 34.05223, longitude: -118.24368, start_date: '2026-09-02', end_date: '2026-09-06' };
  const p = buildStay22Params({ visit, currency: 'EUR', geo: 'box', today: '2026-08-26' });
  assert.ok(!('lat' in p) && !('lng' in p)); // гео уходит ОДНО
  for (const k of ['swlat', 'swlng', 'nelat', 'nelng']) assert.equal(typeof p[k], 'number');
  // Даты и прочее не зависят от гео-режима.
  assert.equal(p.checkin, '2026-09-02');
  assert.equal(p.checkout, '2026-09-06');
});

test('GEO_MODES: список режимов — он же порядок склейки', () => {
  assert.deepEqual(GEO_MODES, ['point', 'box']);
});

test('неизвестный режим не молчит боком: тело собирается точкой, а не пустым гео', () => {
  const visit = { id: 'c1', latitude: 34.05223, longitude: -118.24368, start_date: '2026-09-02', end_date: '2026-09-06' };
  const p = buildStay22Params({ visit, currency: 'EUR', geo: 'нечто', today: '2026-08-26' });
  assert.equal(p.lat, 34.05223); // деградация в точку, а не запрос без координат
});

test('distanceKm: битый центр даёт null, а не NaN (NaN «равен» всему при сортировке)', () => {
  const r = { id: 'x', suppliers: {}, location: { coordinates: [-118.24, 34.05] }, rating: {} };
  assert.equal(normalizeStay22({ results: [r] }, { lat: NaN, lng: -118.24 }).hotels[0].distanceKm, null);
  assert.equal(normalizeStay22({ results: [r] }, { lat: 34.05 }).hotels[0].distanceKm, null);
});

test('buildStay22Params: без флага коробки тело прежнее — точка, углов нет', () => {
  const visit = { id: 'c1', latitude: 34.05223, longitude: -118.24368, start_date: '2026-09-02', end_date: '2026-09-06' };
  const p = buildStay22Params({ visit, currency: 'EUR', today: '2026-08-26' });
  assert.equal(p.lat, 34.05223);
  assert.equal(p.lng, -118.24368);
  for (const k of ['swlat', 'swlng', 'nelat', 'nelng']) assert.ok(!(k in p));
});

test('отсечка прошлых дат действует в ОБОИХ режимах', () => {
  const past = { id: 'c1', latitude: 34.05, longitude: -118.24, start_date: '2026-08-20', end_date: '2026-08-24' };
  assert.equal(buildStay22Params({ visit: past, geo: 'point', today: '2026-08-26' }), null);
  assert.equal(buildStay22Params({ visit: past, geo: 'box', today: '2026-08-26' }), null);
});

// ── Расстояние и порядок склеенного пула ────────────────────────────────────

const RESULT = (id, lat, lng) => ({
  id, name: id, suppliers: { booking: { link: 'l', price: { total: 10 } } },
  location: { coordinates: [lng, lat], address: 'a' }, rating: {},
});

test('normalizeStay22: distanceKm считается от переданного центра', () => {
  const center = { lat: 34.05223, lng: -118.24368 };
  const { hotels } = normalizeStay22({ results: [RESULT('near', 34.0530, -118.2440), RESULT('far', 34.15, -118.24)] }, center);
  assert.ok(hotels[0].distanceKm < 0.2);
  assert.ok(hotels[1].distanceKm > 10);
});

test('normalizeStay22: без центра distanceKm пуст, а не ноль (ноль значил бы «в центре»)', () => {
  const { hotels } = normalizeStay22({ results: [RESULT('x', 34.05, -118.24)] });
  assert.equal(hotels[0].distanceKm, null);
});

test('«рекомендованные» = ближайшие: склейка двух выдач упорядочена по удалению', () => {
  // Порядок на входе — как после mergeById: сначала вся точечная выдача, потом
  // коробочная. Без явной меры это и осталось бы «порядком склейки».
  const pool = [
    { id: 'a', distanceKm: 0.4 }, { id: 'b', distanceKm: 5.1 },
    { id: 'c', distanceKm: 0.9 }, { id: 'd', distanceKm: 23.2 },
  ];
  const out = applyClientFilters(pool, { ...BASE_HOTEL_FILTERS, sortBy: 'recommended' });
  assert.deepEqual(out.map((h) => h.id), ['a', 'c', 'b', 'd']);
});
