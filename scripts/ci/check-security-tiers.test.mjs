#!/usr/bin/env node
/**
 * Tests for the storage-predicate half of CI guard 2e
 * (scripts/ci/check-security-tiers.mjs, TRIP-274).
 *
 * WHY this file exists. Until TRIP-274 the guard checked that a bucket policy
 * EXISTED, never what it said. That is exactly why it stayed green while all
 * four policies of the private `trips` bucket sat on the READ predicate and a
 * viewer could put bytes into a trip folder: the policy was there, it just let
 * the wrong tier through. The fix adds predicate matching — so the matching
 * itself now needs a test, per CLAUDE.md ("a CI guard is code: it gets a test").
 *
 * Scope, stated honestly: `checkBucketPredicates` is the pure decision half and
 * is covered end to end below. The psql/JSON plumbing around it (`checkLive`)
 * still has no test — it needs a live database, and the LIVE assert runs
 * post-deploy, not on the PR. What that plumbing can get wrong is a query that
 * returns nothing; the `undefined`-guard cases below pin the behaviour that
 * would then result (silence, deferring to the existence check) so it is a
 * deliberate choice rather than an accident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBucketPredicates } from './check-security-tiers.mjs';

// Манифест-фикстура той же формы, что BUCKETS в security-tiers.mjs.
const TRIPS = {
  trips: {
    public: false,
    policies: ['select', 'insert', 'update', 'delete'],
    readPredicate: '_can_access_trip_file',
    writePredicate: '_can_write_trip_file',
  },
};

const policy = (name, pred) => ({ name, pred });

// Как выглядит бакет ПОСЛЕ TRIP-274 — эталон.
const healthy = [
  policy('trips_select', `(bucket_id = 'trips' AND (_drafts_branch OR _can_access_trip_file(name)))`),
  policy('trips_insert', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
  policy('trips_update', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name))) (bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
  policy('trips_delete', `(bucket_id = 'trips' AND (_drafts_branch OR _can_write_trip_file(name)))`),
];

test('здоровый бакет: ошибок нет', () => {
  assert.deepEqual(checkBucketPredicates(healthy, TRIPS), []);
});

// ── Регрессия, ради которой всё это написано ────────────────────────────────
test('ДО TRIP-274: все четыре команды на читающем предикате → падает на трёх', () => {
  const before = [
    policy('trips_select', `_can_access_trip_file(name)`),
    policy('trips_insert', `_can_access_trip_file(name)`),
    policy('trips_update', `_can_access_trip_file(name)`),
    policy('trips_delete', `_can_access_trip_file(name)`),
  ];
  const errors = checkBucketPredicates(before, TRIPS);
  assert.equal(errors.length, 3, `ожидались insert/update/delete, получено: ${JSON.stringify(errors)}`);
  for (const cmd of ['insert', 'update', 'delete']) {
    assert.ok(errors.some((e) => e.includes(`'trips_${cmd}'`)), `нет ошибки про trips_${cmd}`);
  }
  // SELECT в этом состоянии корректен — гард не должен ругаться на чтение.
  assert.ok(!errors.some((e) => e.includes('trips_select')), 'ложное срабатывание на trips_select');
});

test('откат одной команды на читающий предикат ловится', () => {
  const drifted = healthy.map((p) => (p.name === 'trips_delete' ? policy('trips_delete', '_can_access_trip_file(name)') : p));
  const errors = checkBucketPredicates(drifted, TRIPS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /trips_delete/);
});

// ── Обратная регрессия: чтение ужали до редакторов ──────────────────────────
test('SELECT на write-предикате → чтение ужалось до редакторов', () => {
  const tightened = healthy.map((p) => (p.name === 'trips_select' ? policy('trips_select', '_can_write_trip_file(name)') : p));
  const errors = checkBucketPredicates(tightened, TRIPS);
  // Две жалобы: нет read-предиката И появился write-предикат.
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.includes('trips_select')));
  assert.ok(errors.some((e) => /ужалось до редакторов/.test(e)));
});

// ── Границы ─────────────────────────────────────────────────────────────────
test('бакет без объявленных предикатов не проверяется (avatars)', () => {
  const manifest = { avatars: { public: true, policies: ['insert', 'update', 'delete'] } };
  assert.deepEqual(checkBucketPredicates([policy('avatars_insert', 'что угодно')], manifest), []);
});

test('отсутствующая политика молчит — её ловит проверка наличия, не эта', () => {
  const missing = healthy.filter((p) => p.name !== 'trips_delete');
  assert.deepEqual(checkBucketPredicates(missing, TRIPS), []);
});

test('пустой список политик не роняет и не выдумывает ошибок', () => {
  assert.deepEqual(checkBucketPredicates([], TRIPS), []);
  assert.deepEqual(checkBucketPredicates(undefined, TRIPS), []);
});

test('политика без текста предиката считается несоответствующей', () => {
  const blank = healthy.map((p) => (p.name === 'trips_insert' ? policy('trips_insert', '') : p));
  const errors = checkBucketPredicates(blank, TRIPS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /trips_insert/);
});

test('команда, не объявленная в policies манифеста, не проверяется', () => {
  const manifest = { trips: { ...TRIPS.trips, policies: ['select', 'insert'] } };
  const drifted = healthy.map((p) => (p.name === 'trips_delete' ? policy('trips_delete', 'что-то чужое') : p));
  assert.deepEqual(checkBucketPredicates(drifted, manifest), []);
});

// Подстрока write-предиката не должна засчитываться за read-предикат и наоборот.
test('имена предикатов не путаются на общем префиксе', () => {
  const manifest = { b: { public: false, policies: ['select', 'insert'], readPredicate: '_can_read_x', writePredicate: '_can_read_x_write' } };
  const ok = [
    policy('b_select', '_can_read_x(name)'),
    policy('b_insert', '_can_read_x_write(name)'),
  ];
  // b_insert содержит и '_can_read_x' как подстроку — это допустимо, проверяется
  // только наличие write-предиката в write-политике.
  assert.deepEqual(checkBucketPredicates(ok, manifest), []);

  const bad = [
    policy('b_select', '_can_read_x_write(name)'), // чтение ужато
    policy('b_insert', '_can_read_x(name)'),        // запись ослаблена
  ];
  const errors = checkBucketPredicates(bad, manifest);
  assert.equal(errors.length, 2);
});
