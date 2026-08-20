// Golden cases for the canonical client date-chain layout (lib/tripDates.layoutDates),
// kept 1:1 with server recompute_trip (migrations 0043 + 0049). Run: npm test (node --test)
//
// Focus: anchor MATERIALIZATION (0049). start = anchor day (pre-gap, stays put while the
// start->city1 gap moves city1); end = last checkout + its own incoming-leg gap (finish
// moves on an overnight last->finish leg). Anchors carry one date and no nights.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDates } from './tripDates.js';

const BASE = '2026-09-11'; // anchor = departure day of the first leg leaving `start`

test('anchors flush: start = anchor day, end = last checkout', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 4, gap: 0 },
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[0].start_date, '2026-09-11');
  assert.equal(laid[0].end_date, '2026-09-11');
  assert.equal(laid[0].nights, null);
  assert.equal(laid[1].start_date, '2026-09-11');
  assert.equal(laid[1].end_date, '2026-09-15'); // +4 nights
  assert.equal(laid[2].start_date, '2026-09-15'); // checkout of last city
  assert.equal(laid[2].end_date, '2026-09-15');
});

test('overnight start->city1: start STAYS, city1 moves +1', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 4, gap: 1 }, // day_change on start->city1 leg
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[0].start_date, '2026-09-11'); // start does NOT move
  assert.equal(laid[1].start_date, '2026-09-12'); // arrival day
  assert.equal(laid[1].end_date, '2026-09-16');
  assert.equal(laid[2].start_date, '2026-09-16');
});

test('overnight last->finish: finish itself moves +1', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 4, gap: 0 },
    { id: 'e', kind: 'end', gap: 1 }, // day_change on last->finish leg
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[0].start_date, '2026-09-11');
  assert.equal(laid[1].end_date, '2026-09-15');
  assert.equal(laid[2].start_date, '2026-09-16'); // 09-15 checkout + 1
  assert.equal(laid[2].end_date, '2026-09-16');
});

test('waypoint between start and city1 keeps single date; anchors still materialized', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'w', kind: 'waypoint', gap: 0 },
    { id: 'c1', kind: 'transit', nights: 2, gap: 0 },
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[0].start_date, '2026-09-11');
  assert.equal(laid[1].start_date, '2026-09-11'); // waypoint, same day
  assert.equal(laid[1].end_date, '2026-09-11');
  assert.equal(laid[2].start_date, '2026-09-11');
  assert.equal(laid[2].end_date, '2026-09-13');
  assert.equal(laid[3].start_date, '2026-09-13'); // finish = last checkout
});

test('two consecutive overnight legs accumulate (+2): mirrors a multi-leg layover', () => {
  // c1 --overnight--> waypoint --overnight--> c2. Each day_change adds a day, so c2
  // lands at c1's checkout + 2. Guards the server layover behaviour (add_layover_transfer
  // with two day_change segments), verified 1:1 against recompute_trip.
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 2, gap: 0 },
    { id: 'w', kind: 'waypoint', gap: 1 },   // overnight c1 -> waypoint
    { id: 'c2', kind: 'transit', nights: 2, gap: 1 }, // overnight waypoint -> c2
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[1].end_date, '2026-09-13');   // c1 checkout
  assert.equal(laid[2].start_date, '2026-09-14');  // waypoint = +1
  assert.equal(laid[2].end_date, '2026-09-14');    // single date
  assert.equal(laid[3].start_date, '2026-09-15');  // c2 = checkout + 2 (accumulated)
  assert.equal(laid[3].end_date, '2026-09-17');
  assert.equal(laid[4].start_date, '2026-09-17');  // finish = last checkout
});

test('mid-chain waypoint consumes no nights; the city after it does NOT shift', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 3, gap: 0 },
    { id: 'w', kind: 'waypoint', gap: 0 },   // between two cities, no day_change
    { id: 'c2', kind: 'transit', nights: 2, gap: 0 },
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[1].end_date, '2026-09-14');   // c1 checkout (3 nights)
  assert.equal(laid[2].start_date, '2026-09-14');  // waypoint sits on that day
  assert.equal(laid[2].end_date, '2026-09-14');
  assert.equal(laid[3].start_date, '2026-09-14');  // c2 starts same day (waypoint took 0 nights)
  assert.equal(laid[3].end_date, '2026-09-16');
  assert.equal(laid[4].start_date, '2026-09-16');
});

test('multi-day transfer (gap=3): the arrival city and all following shift +3', () => {
  // A non-binary day_span: a 3-day crossing c1 -> c2 pushes c2 (and everything after)
  // three days past c1's checkout. Mirrors recompute_trip reading transfers.day_span.
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 2, gap: 0 },
    { id: 'c2', kind: 'transit', nights: 2, gap: 3 },
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const laid = layoutDates(nodes, BASE);
  assert.equal(laid[1].end_date, '2026-09-13');   // c1 checkout (2 nights from 09-11)
  assert.equal(laid[2].start_date, '2026-09-16');  // +3 days
  assert.equal(laid[2].end_date, '2026-09-18');
  assert.equal(laid[3].start_date, '2026-09-18');  // finish = last checkout
});

test('reorder re-anchors on base, not on the first node\'s stale date (TRIP-216)', () => {
  // The planner's recomputeDates wrapper lays out a flat transit chain from the
  // FIXED trip start. Simulate a reorder: the node dragged to the top still carries
  // its old (later) start_date, but with `base` fixed the whole chain must re-anchor
  // on `base` — NOT on that stale first-node date.
  const reordered = [
    { id: 'c3', kind: 'transit', nights: 3, gap: 0, start_date: '2026-09-20', end_date: null }, // was last, dragged to top
    { id: 'c1', kind: 'transit', nights: 3, gap: 0, start_date: '2026-09-11', end_date: null },
    { id: 'c2', kind: 'transit', nights: 3, gap: 0, start_date: '2026-09-14', end_date: null },
  ];
  const laid = layoutDates(reordered, BASE);
  assert.equal(laid[0].start_date, '2026-09-11'); // anchored on BASE, not 09-20
  assert.equal(laid[0].end_date, '2026-09-14');
  assert.equal(laid[1].start_date, '2026-09-14');
  assert.equal(laid[2].start_date, '2026-09-17');
  assert.equal(laid[2].end_date, '2026-09-20');
});

test('idempotent: a second pass over laid-out nodes reproduces the same dates', () => {
  const nodes = [
    { id: 's', kind: 'start' },
    { id: 'c1', kind: 'transit', nights: 3, gap: 1 },
    { id: 'c2', kind: 'transit', nights: 2, gap: 0 },
    { id: 'e', kind: 'end', gap: 0 },
  ];
  const once = layoutDates(nodes, BASE);
  const twice = layoutDates(once, BASE);
  assert.deepEqual(
    twice.map((n) => [n.start_date, n.end_date]),
    once.map((n) => [n.start_date, n.end_date]),
  );
});
