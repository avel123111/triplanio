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
