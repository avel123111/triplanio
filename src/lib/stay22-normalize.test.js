// Unit tests for Stay22 mapping + param building. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStay22, buildStay22Params, ensureNextDay, mergePool, POOL_MAX, filterParams, applyClientFilters } from './stay22-normalize.js';

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

test('mergePool: dedups by id across pages, first occurrence wins, preserves order', () => {
  const p1 = [{ id: 'a', price: 1 }, { id: 'b', price: 2 }];
  const p2 = [{ id: 'b', price: 999 }, { id: 'c', price: 3 }]; // 'b' repeats
  const { hotels, truncated } = mergePool([p1, p2]);
  assert.deepEqual(hotels.map((h) => h.id), ['a', 'b', 'c']);
  assert.equal(hotels[1].price, 2); // first 'b' kept, not the later duplicate
  assert.equal(truncated, false);
});

test('mergePool: skips loading (undefined) pages and id-less / null entries', () => {
  const p1 = [{ id: 'a' }, null, { name: 'no id' }];
  const { hotels } = mergePool([p1, undefined]);
  assert.deepEqual(hotels.map((h) => h.id), ['a']);
});

test('mergePool: caps at POOL_MAX and flags truncated', () => {
  const big = Array.from({ length: POOL_MAX + 25 }, (_, i) => ({ id: `h${i}` }));
  const { hotels, truncated } = mergePool([big]);
  assert.equal(hotels.length, POOL_MAX);
  assert.equal(truncated, true);
});

test('filterParams: passes guests + provider, never price (client-side now)', () => {
  assert.deepEqual(filterParams({ adults: 3, children: 1, rooms: 2, provider: 'booking' }), { adults: 3, children: 1, rooms: 2, provider: 'booking' });
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
