// Unit tests for Stay22 mapping + param building. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStay22, buildStay22Params, ensureNextDay, filterParams, applyClientFilters, BASE_HOTEL_FILTERS, STAY22_FILTER_SPEC } from './stay22-normalize.js';

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
  const p = buildStay22Params({ visit, currency: 'EUR', lang: 'ru' });
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
