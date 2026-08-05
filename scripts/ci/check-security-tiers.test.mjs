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
 *
 * Everything here rides on the guard staying importable without side effects.
 * That premise cannot be checked from this file — an import that calls
 * process.exit(0) kills the runner before the first test registers, and the
 * runner then prints "pass 1, fail 0" for the file. It is pinned from
 * check-security-tiers.cli.test.mjs, which never imports the guard.
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
  // По ДВЕ жалобы на каждую write-команду: write-предиката нет И стоит read.
  assert.equal(errors.length, 6, `ожидались insert/update/delete ×2, получено: ${JSON.stringify(errors)}`);
  for (const cmd of ['insert', 'update', 'delete']) {
    const mine = errors.filter((e) => e.includes(`'trips_${cmd}'`));
    assert.equal(mine.length, 2, `trips_${cmd}: ${JSON.stringify(mine)}`);
    assert.ok(mine.some((e) => /не ссылается на write-предикат/.test(e)));
    assert.ok(mine.some((e) => /write-гейт обойдён/.test(e)));
  }
  // SELECT в этом состоянии корректен — гард не должен ругаться на чтение.
  assert.ok(!errors.some((e) => e.includes('trips_select')), 'ложное срабатывание на trips_select');
});

test('откат одной команды на читающий предикат ловится', () => {
  const drifted = healthy.map((p) => (p.name === 'trips_delete' ? policy('trips_delete', '_can_access_trip_file(name)') : p));
  const errors = checkBucketPredicates(drifted, TRIPS);
  assert.equal(errors.length, 2, JSON.stringify(errors));
  assert.ok(errors.every((e) => e.includes('trips_delete')));
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

// ── Обход дизъюнкцией: write-предикат на месте, но рядом ORнут read ─────────
// Нашёл ревьюер Codex на PR #678. Первая версия требовала лишь НАЛИЧИЯ
// write-предиката, поэтому `read(name) OR write(name)` проходила зелёной —
// а пускает такая политика участника, то есть дыра остаётся открытой при
// довольном страже.
test('read-предикат, ORнутый в write-политику, ловится', () => {
  const bypassed = healthy.map((p) => (p.name === 'trips_insert'
    ? policy('trips_insert', `(_can_access_trip_file(name) OR _can_write_trip_file(name))`)
    : p));
  const errors = checkBucketPredicates(bypassed, TRIPS);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /trips_insert/);
  assert.match(errors[0], /write-гейт обойдён/);
});

test('обход дизъюнкцией ловится на каждой из трёх write-команд', () => {
  for (const cmd of ['insert', 'update', 'delete']) {
    const bypassed = healthy.map((p) => (p.name === `trips_${cmd}`
      ? policy(`trips_${cmd}`, `_can_access_trip_file(name) OR _can_write_trip_file(name)`)
      : p));
    const errors = checkBucketPredicates(bypassed, TRIPS);
    assert.equal(errors.length, 1, `${cmd}: ${JSON.stringify(errors)}`);
    assert.match(errors[0], new RegExp(`trips_${cmd}`));
  }
});

// Дизъюнкт `_drafts/<uid>/` в write-политике ЗАКОННЫЙ и обязан молчать: он
// пер-юзерный, черновик обложки заливают до существования трипа.
test('ветка _drafts в write-политике не считается обходом', () => {
  assert.deepEqual(checkBucketPredicates(healthy, TRIPS), []);
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

// Сверка идёт по ВЫЗОВУ функции, а не по подстроке. Пара, где одно имя —
// префикс другого, это и проверяет: подстрочное совпадение выдало бы
// `_can_read_x` внутри `_can_read_x_write(...)` и, с запретом read-предиката в
// write-политике, дало бы ЛОЖНОЕ падение на здоровом бакете.
test('предикат-префикс: однокоренное имя не считается вызовом', () => {
  const manifest = { b: { public: false, policies: ['select', 'insert'], readPredicate: '_can_read_x', writePredicate: '_can_read_x_write' } };
  const ok = [
    policy('b_select', '_can_read_x(name)'),
    policy('b_insert', '_can_read_x_write(name)'),
  ];
  assert.deepEqual(checkBucketPredicates(ok, manifest), []);

  const bad = [
    policy('b_select', '_can_read_x_write(name)'), // чтение ужато до редакторов
    policy('b_insert', '_can_read_x(name)'),       // запись открыта участнику
  ];
  const errors = checkBucketPredicates(bad, manifest);
  // По две точные жалобы на каждую политику: «не тот предикат» + «не тот сосед».
  assert.equal(errors.length, 4, JSON.stringify(errors));
  assert.equal(errors.filter((e) => e.includes("'b_select'")).length, 2);
  assert.equal(errors.filter((e) => e.includes("'b_insert'")).length, 2);
  assert.ok(errors.some((e) => /ужалось до редакторов/.test(e)));
  assert.ok(errors.some((e) => /write-гейт обойдён/.test(e)));
});

// Схема-квалифицированный вызов — то, как pg_policies обычно и печатает qual.
test('вызов с квалификацией схемой засчитывается', () => {
  const qualified = healthy.map((p) => policy(p.name, p.pred.replace(/_can_(access|write)_trip_file/g, 'public._can_$1_trip_file')));
  assert.deepEqual(checkBucketPredicates(qualified, TRIPS), []);
});
