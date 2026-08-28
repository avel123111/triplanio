// Unit tests for the writeRows primitive (TRIP-66).
// Run: npm test  (node --test)
//
// writeRows is the single contract "did the write actually land?". A raw
// supabase mutation swallows both a real { error } and a silent 0-row RLS
// reject; these tests lock the behaviour so a future refactor can't quietly
// bring the swallow back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeRows, reconcileBookingWrite, pruneCityContent, TRIP_CONTENT_KEY, TRIP_SHELL_KEY } from './trip-data.js';

// Minimal fake of a PostgREST builder: writeRows only calls `.select()`, which
// resolves to `{ data, error }`. `.select()` returns the builder-as-thenable.
function fakeBuilder({ data = null, error = null } = {}) {
  return { select: () => Promise.resolve({ data, error }) };
}

test('resolves with rows on a successful write', async () => {
  const rows = await writeRows(fakeBuilder({ data: [{ id: 'a' }] }));
  assert.deepEqual(rows, [{ id: 'a' }]);
});

test('throws the original error when the builder returns { error }', async () => {
  const err = new Error('network down');
  await assert.rejects(
    () => writeRows(fakeBuilder({ error: err })),
    (e) => e === err,
  );
});

test('insert/update: 0 affected rows is a silent RLS reject → throws write_rejected', async () => {
  // expectRow defaults to true. Empty array = PostgREST hid the row (expired
  // session / removed from trip). Must NOT look like success.
  await assert.rejects(
    () => writeRows(fakeBuilder({ data: [] })),
    (e) => e.message === 'write_rejected',
  );
  await assert.rejects(
    () => writeRows(fakeBuilder({ data: null })),
    (e) => e.message === 'write_rejected',
  );
});

test('delete (expectRow:false): 0 affected rows is benign → resolves, no throw', async () => {
  // A row already deleted by another member is not an error for a delete.
  const rows = await writeRows(fakeBuilder({ data: [] }), { expectRow: false });
  assert.deepEqual(rows, []);
});

test('delete (expectRow:false): still throws on a real error', async () => {
  const err = new Error('boom');
  await assert.rejects(
    () => writeRows(fakeBuilder({ error: err }), { expectRow: false }),
    (e) => e === err,
  );
});

// ── Зеркало «бронь → трата» в кэше (TRIP-484) ────────────────────────────────
//
// Зеркало ведёт БД (триггер sync_budget_expense), клиент только СВОРАЧИВАЕТ то,
// что вернул шов. Тесты держат ровно это: свои правила про траты клиент не
// изобретает, но и не теряет ответ.

// Минимальный двойник queryClient: ключи — как в react-query, сериализуются.
function fakeQc(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getQueryData: (key) => store.get(JSON.stringify(key)),
    setQueryData: (key, updater) => {
      const k = JSON.stringify(key);
      store.set(k, typeof updater === 'function' ? updater(store.get(k)) : updater);
    },
  };
}
const CONTENT = (id) => JSON.stringify(TRIP_CONTENT_KEY(id));
const SHELL = (id) => JSON.stringify(TRIP_SHELL_KEY(id));

test('reconcileBookingWrite: набор трат из ответа заменяет срез целиком', () => {
  const qc = fakeQc({
    [CONTENT('t1')]: { transfers: [{ id: 'tr1' }], budgetExpenses: [{ id: 'e1', source_kind: 'transfer', source_id: 'tr1' }] },
  });
  // Удалили трансфер: шов вернул набор БЕЗ его траты (её снёс триггер).
  const row = reconcileBookingWrite(qc, 't1', { row: null, cities: null, transfers: [], expenses: [] });
  assert.equal(row, null);
  assert.deepEqual(qc.getQueryData(TRIP_CONTENT_KEY('t1')).budgetExpenses, []);
  assert.deepEqual(qc.getQueryData(TRIP_CONTENT_KEY('t1')).transfers, []);
});

test('reconcileBookingWrite: чего в ответе нет — то не трогаем', () => {
  const before = { transfers: [{ id: 'tr1' }], budgetExpenses: [{ id: 'e1' }] };
  const qc = fakeQc({ [CONTENT('t1')]: before });
  // Лист (отель) без цепочки: пришла только строка + траты.
  reconcileBookingWrite(qc, 't1', { row: { id: 'h1' }, cities: null, transfers: null, expenses: [{ id: 'e2' }] });
  const after = qc.getQueryData(TRIP_CONTENT_KEY('t1'));
  assert.deepEqual(after.transfers, before.transfers);      // срез не тронут
  assert.deepEqual(after.budgetExpenses, [{ id: 'e2' }]);
});

test('reconcileBookingWrite: возвращает записанную строку для сворачивания в свой срез', () => {
  const qc = fakeQc({ [CONTENT('t1')]: { hotels: [] } });
  assert.deepEqual(reconcileBookingWrite(qc, 't1', { row: { id: 'h1' }, expenses: null }), { id: 'h1' });
  // Мусор вместо ответа не роняет и ничего не пишет.
  assert.equal(reconcileBookingWrite(qc, 't1', null), null);
});

test('pruneCityContent: с городом уходят брони И их траты, ручная трата остаётся без города', () => {
  const qc = fakeQc({
    [CONTENT('t1')]: {
      hotels: [{ id: 'h1', city_visit_id: 'c1' }, { id: 'h2', city_visit_id: 'c2' }],
      activities: [{ id: 'a1', city_visit_id: 'c1' }],
      transfers: [{ id: 'tr1', from_city_visit_id: 'c1', to_city_visit_id: 'c2' }],
      budgetExpenses: [
        { id: 'e1', source_kind: 'hotel', source_id: 'h1' },      // уедет с отелем
        { id: 'e2', source_kind: 'activity', source_id: 'a1' },   // уедет с активностью
        { id: 'e3', source_kind: 'transfer', source_id: 'tr1' },  // уедет с переездом
        { id: 'e4', source_kind: 'hotel', source_id: 'h2' },      // чужой город — остаётся
        { id: 'e5', city_visit_id: 'c1', city_name: 'Порту' },    // ручная: FK SET NULL
      ],
    },
    [SHELL('t1')]: { cityVisits: [] },
  });
  pruneCityContent(qc, 't1', 'c1');
  const after = qc.getQueryData(TRIP_CONTENT_KEY('t1'));
  assert.deepEqual(after.hotels.map((h) => h.id), ['h2']);
  assert.deepEqual(after.activities, []);
  assert.deepEqual(after.transfers, []);
  assert.deepEqual(after.budgetExpenses.map((e) => e.id), ['e4', 'e5']);
  assert.equal(after.budgetExpenses.find((e) => e.id === 'e5').city_visit_id, null);
  assert.equal(after.budgetExpenses.find((e) => e.id === 'e5').city_name, 'Порту'); // подпись-фолбэк цела
});
