// Unit tests for Stay22 mapping + param building. Run: npm test (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStay22, buildStay22Params, ensureNextDay } from './stay22-normalize.js';

const SAMPLE = {
  meta: { pageSize: 10, count: 2, page: 1, hasMore: true, total: 32, currency: 'USD', checkin: '2026-10-05', checkout: '2026-10-10', nights: 5 },
  results: [
    {
      id: '32497041.0000',
      url: 'https://www.stay22.com/allez/roam/usds_32497041.0000?aid=triplanio',
      suppliers: { booking: { id: '15771687', link: 'https://www.stay22.com/allez/booking/15771687', media: { logoSquare: 'https://r2.stay22.com/2025_booking.png' }, price: { total: 328 } } },
      name: 'C&H Aravaca Garden', type: 'Accommodation',
      location: { address: 'Calle Burgohondo, 8, Madrid, 28023, Spain' },
      rating: { value: 7, hotelStars: 3, count: 60 },
      media: { thumbnail: 'https://example/thumb.jpg' },
    },
    {
      id: 'noreview.0000',
      url: 'https://www.stay22.com/allez/roam/noreview',
      suppliers: { booking: { id: '1', link: 'https://x', media: { logoSquare: 'l' } } }, // no price
      name: 'No Reviews Place', type: 'Accommodation',
      location: { address: 'Somewhere' },
      rating: { value: 0, hotelStars: null, count: 0 },
      media: { thumbnail: '' },
    },
  ],
};

test('normalizeStay22: maps price, currency, url, rating, stars', () => {
  const { hotels, meta } = normalizeStay22(SAMPLE);
  assert.equal(hotels.length, 2);
  const a = hotels[0];
  assert.equal(a.price, 328);
  assert.equal(a.currency, 'USD');
  assert.equal(a.url, 'https://www.stay22.com/allez/roam/usds_32497041.0000?aid=triplanio');
  assert.equal(a.bookingLogo, 'https://r2.stay22.com/2025_booking.png');
  assert.equal(a.ratingValue, 7);
  assert.equal(a.ratingCount, 60);
  assert.equal(a.stars, 3);
  assert.equal(meta.total, 32);
  assert.equal(meta.nights, 5);
  assert.equal(meta.hasMore, true);
});

test('normalizeStay22: hides price and rating when absent / zero reviews', () => {
  const { hotels } = normalizeStay22(SAMPLE);
  const b = hotels[1];
  assert.equal(b.price, null);
  assert.equal(b.ratingValue, null);
  assert.equal(b.ratingCount, null);
  assert.equal(b.stars, null);
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
