// Tests for the canonical optimistic-mutation seam (optimism epic).
//   withOptimism   — the useMutation lifecycle (cancel → snapshot → patch →
//                    reconcile-from-row → rollback), toast hooks
//   tripContentBinding — binding for the {kind:[...]} trip-content cache
//   listBinding    — binding for a bare-array cache at one key (documents, …)
//
// The whole point of the seam is a set of behaviours every hand-rolled copy got
// subtly wrong. Each is pinned here, and the load-bearing one — cancelQueries
// BEFORE the optimistic patch — has its own guard so the flicker bug can't come
// back silently. No React, no Supabase: the seam is a pure options builder over
// a query client, so a tiny fake client is all it needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withOptimism,
  formWrite,
  withRecompute,
  reconcileWriteRow,
  tripContentBinding,
  listBinding,
  swapOptimisticRow,
  TRIP_CONTENT_KEY,
  TRIP_SHELL_KEY,
  TRIP_CARD_KEY,
  cacheTripCards,
  tripShellFacts,
} from './trip-data.js';
import { menuSections } from './tripMenu.js';

const k = (key) => JSON.stringify(key);

// Minimal QueryClient stand-in: a keyed store + the methods the seam uses.
// Records cancelQueries calls (in order) so a test can prove cancel-before-patch.
function makeQC(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, val]) => [key, val]));
  const events = [];
  return {
    events,
    get: (key) => store.get(k(key)),
    async cancelQueries({ queryKey }) { events.push(`cancel:${k(queryKey)}`); },
    getQueryData: (key) => store.get(k(key)),
    setQueryData: (key, updater) => {
      events.push(`set:${k(key)}`);
      const prev = store.get(k(key));
      store.set(k(key), typeof updater === 'function' ? updater(prev) : updater);
    },
  };
}

const TRIP = 't1';
const CONTENT = TRIP_CONTENT_KEY(TRIP);
const SHELL = TRIP_SHELL_KEY(TRIP);
const DOCS = ['trip-docs', TRIP];

// ─── trip-content binding ─────────────────────────────────────────────────────

test('trip-content add: tmp row appears, then reconciles to the returned real row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-x', name: 'Hilton' } });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'tmp-x'], 'tmp row shown immediately');

  life.onSuccess([{ id: 'real-9', name: 'Hilton' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'tmp swapped for real id in place');
});

test('withOptimism onOptimistic: fires in onMutate AFTER the patch (T0 — close UI in sync with the dim)', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  const events = [];
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), {
    op: 'remove',
    onOptimistic: () => events.push(`optimistic:${qc.get(CONTENT).hotels.length}`), // sees the post-patch cache
    onSuccess: () => events.push('success'),
  });
  await life.onMutate({ id: 'h1' });
  life.onSuccess(undefined, { id: 'h1' }, {});
  // onOptimistic ran at T0 with the row already removed (len 0); success ran later.
  assert.deepEqual(events, ['optimistic:0', 'success'], 'onOptimistic at T0 after patch, then success');
});

test('cancelQueries runs BEFORE the optimistic patch (flicker guard)', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add' });

  await life.onMutate({ row: { id: 'tmp-x' } });

  const cancelIdx = qc.events.indexOf(`cancel:${k(CONTENT)}`);
  const setIdx = qc.events.indexOf(`set:${k(CONTENT)}`);
  assert.ok(cancelIdx >= 0, 'cancelQueries was called for the content key');
  assert.ok(setIdx >= 0 && setIdx > cancelIdx, 'cancel happens before the cache is patched');
});

test('trip-content add: onError restores the snapshot and calls the caller toast', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  let toasted = null;
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), { op: 'add', onError: (e) => { toasted = e; } });

  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  assert.equal(qc.get(CONTENT).hotels.length, 2, 'tmp row present while in flight');

  const err = new Error('write_rejected');
  life.onError(err, { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1'], 'rolled back to the snapshot, tmp gone');
  assert.equal(toasted, err, 'the error reached the call-site toast');
});

test('update: optimistic partial patch, then authoritative merge from the returned row', async () => {
  const qc = makeQC({ [k(CONTENT)]: { activities: [{ id: 'a1', title: 'Old', notes: 'keep' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'activities'), { op: 'update' });

  const ctx = await life.onMutate({ row: { id: 'a1', title: 'New' } });
  assert.equal(qc.get(CONTENT).activities[0].title, 'New', 'optimistic field applied');
  assert.equal(qc.get(CONTENT).activities[0].notes, 'keep', 'untouched fields preserved (partial patch)');

  life.onSuccess([{ id: 'a1', title: 'New', notes: 'keep', server_stamp: 42 }], { row: { id: 'a1' } }, ctx);
  assert.equal(qc.get(CONTENT).activities[0].server_stamp, 42, 'server-authoritative row merged in');
});

test('remove: drops the row on mutate, restores it on error, no reconcile on success', async () => {
  const qc = makeQC({ [k(CONTENT)]: { services: [{ id: 's1' }, { id: 's2' }] } });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'services'), { op: 'remove' });

  const ctx = await life.onMutate({ id: 's1' });
  assert.deepEqual(qc.get(CONTENT).services.map(r => r.id), ['s2'], 'row removed optimistically');

  const before = qc.events.length;
  life.onSuccess([], { id: 's1' }, ctx);
  assert.equal(qc.events.length, before, 'no cache writes on delete success');

  life.onError(new Error('boom'), { id: 's1' }, ctx);
  assert.deepEqual(qc.get(CONTENT).services.map(r => r.id), ['s1', 's2'], 'delete rolled back');
});

test('cityVisits: mutation touches AND rolls back both content and shell', async () => {
  const qc = makeQC({
    [k(CONTENT)]: { cityVisits: [{ id: 'c1' }] },
    [k(SHELL)]: { cityVisits: [{ id: 'c1' }] },
  });
  const life = withOptimism(tripContentBinding(qc, TRIP, 'cityVisits'), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-c' } });
  assert.equal(qc.get(CONTENT).cityVisits.length, 2, 'content got the tmp city');
  assert.equal(qc.get(SHELL).cityVisits.length, 2, 'shell got the tmp city too');
  assert.ok(qc.events.includes(`cancel:${k(SHELL)}`), 'shell refetch cancelled as well');

  life.onError(new Error('nope'), { row: { id: 'tmp-c' } }, ctx);
  assert.deepEqual(qc.get(CONTENT).cityVisits.map(r => r.id), ['c1'], 'content rolled back');
  assert.deepEqual(qc.get(SHELL).cityVisits.map(r => r.id), ['c1'], 'shell rolled back');
});

test('onSuccess hook fires with (data, vars) for the confirm toast', async () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [] } });
  let got = null;
  const life = withOptimism(tripContentBinding(qc, TRIP, 'hotels'), {
    op: 'add', onSuccess: (data, vars) => { got = { data, vars }; },
  });
  const ctx = await life.onMutate({ row: { id: 'tmp-x' } });
  life.onSuccess([{ id: 'real-9' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(got.data, [{ id: 'real-9' }], 'success toast hook saw the returned row');
  assert.equal(got.vars.row.id, 'tmp-x', 'success toast hook saw the vars');
});

// ─── flat-array (list) binding — the documents cache ──────────────────────────

test('list add: prepends (newest-first) then reconciles tmp→real at the top', async () => {
  const qc = makeQC({ [k(DOCS)]: [{ id: 'd1' }, { id: 'd2' }] });
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'add' });

  const ctx = await life.onMutate({ row: { id: 'tmp-x', title: 'Booking' } });
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['tmp-x', 'd1', 'd2'], 'new doc prepended');

  life.onSuccess([{ id: 'real-9', title: 'Booking' }], { row: { id: 'tmp-x' } }, ctx);
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['real-9', 'd1', 'd2'], 'tmp swapped for real at the top');
});

test('list remove: drops on mutate, restores on error', async () => {
  const qc = makeQC({ [k(DOCS)]: [{ id: 'd1' }, { id: 'd2' }] });
  let toasted = false;
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'remove', onError: () => { toasted = true; } });

  const ctx = await life.onMutate({ id: 'd1' });
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['d2'], 'doc removed optimistically');
  assert.ok(qc.events.includes(`cancel:${k(DOCS)}`), 'docs refetch cancelled first');

  life.onError(new Error('nope'), { id: 'd1' }, ctx);
  assert.deepEqual(qc.get(DOCS).map(r => r.id), ['d1', 'd2'], 'delete rolled back');
  assert.ok(toasted, 'error toast fired');
});

test('list binding never patches a not-yet-loaded cache (old === undefined)', async () => {
  const qc = makeQC({}); // DOCS key absent → query not loaded
  const life = withOptimism(listBinding(qc, DOCS, { addTo: 'start' }), { op: 'add' });
  await life.onMutate({ row: { id: 'tmp-x' } });
  assert.equal(qc.get(DOCS), undefined, 'no phantom one-item list written before the real fetch');
});

// ─── swapOptimisticRow direct (trip-content) ──────────────────────────────────

test('swapOptimisticRow: appends the real row if the tmp row was already clobbered', () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } }); // tmp-x already gone
  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' });
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'real row not lost when tmp missing');

  swapOptimisticRow(qc, TRIP, 'hotels', 'tmp-x', { id: 'real-9' }); // idempotent
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'no duplicate on repeat');
});

// ─── reconcileWriteRow + formWrite (pessimistic form path) ────────────────────

test('reconcileWriteRow add: upserts the returned row by its own id (no tmp)', () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1' }] } });
  const ok = reconcileWriteRow(tripContentBinding(qc, TRIP, 'hotels'), 'add', { id: 'real-9', name: 'Hilton' });
  assert.equal(ok, true, 'folded a single row');
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'returned row appended');
  reconcileWriteRow(tripContentBinding(qc, TRIP, 'hotels'), 'add', { id: 'real-9' }); // idempotent (dedup)
  assert.deepEqual(qc.get(CONTENT).hotels.map(r => r.id), ['h1', 'real-9'], 'no duplicate on repeat');
});

test('reconcileWriteRow update: merges the returned row over the cached one', () => {
  const qc = makeQC({ [k(CONTENT)]: { hotels: [{ id: 'h1', name: 'old' }] } });
  reconcileWriteRow(tripContentBinding(qc, TRIP, 'hotels'), 'update', { id: 'h1', name: 'new' });
  assert.deepEqual(qc.get(CONTENT).hotels, [{ id: 'h1', name: 'new' }], 'authoritative row merged');
});

test('reconcileWriteRow: no single row (array / null) → false, so the caller refetches (E)', () => {
  const qc = makeQC({ [k(CONTENT)]: { transfers: [] } });
  assert.equal(reconcileWriteRow(tripContentBinding(qc, TRIP, 'transfers'), 'add', null), false, 'null → not folded');
  assert.equal(reconcileWriteRow(tripContentBinding(qc, TRIP, 'transfers'), 'add', {}), false, 'no id → not folded');
});

test('formWrite success: reconcile runs THEN onDone (close), onFail never', () => {
  const order = [];
  const life = formWrite({
    reconcile: () => order.push('reconcile'),
    onDone: () => order.push('done'),
    onFail: () => order.push('fail'),
  });
  life.onSuccess({ id: 'x' }, {});
  assert.deepEqual(order, ['reconcile', 'done'], 'reconcile-from-row before the dialog closes');
});

test('formWrite error: onFail fires and onDone does NOT — the dialog stays open', () => {
  const order = [];
  const life = formWrite({
    reconcile: () => order.push('reconcile'),
    onDone: () => order.push('done'),
    onFail: () => order.push('fail'),
  });
  life.onError(new Error('refused'), {});
  assert.deepEqual(order, ['fail'], 'no reconcile, no close on failure');
});

// ─── withRecompute (server-recompute / seq-guarded E path) ────────────────────

// Phase recorder: every phase pushes its name so a test asserts the exact order
// AND that superseded phases never ran. refetch/run may bump the seq to simulate a
// newer action landing mid-flight.
function recorder(seqRef, { bumpOn } = {}) {
  const order = [];
  const mk = (name) => async () => { order.push(name); if (bumpOn === name) seqRef.current++; };
  return {
    order,
    run: mk('run'), refetch: mk('refetch'),
    reconcile: () => order.push('reconcile'),
    commit: () => order.push('commit'),
    rollback: () => order.push('rollback'),
    onError: () => order.push('error'),
  };
}

test('withRecompute happy path: run → reconcile → refetch → commit, in order', async () => {
  const seqRef = { current: 0 };
  const r = recorder(seqRef);
  await withRecompute(seqRef, r);
  assert.deepEqual(r.order, ['run', 'reconcile', 'refetch', 'commit'], 'phases ran in lifecycle order');
});

test('withRecompute superseded DURING run: reconcile/refetch/commit all skipped', async () => {
  const seqRef = { current: 0 };
  const r = recorder(seqRef, { bumpOn: 'run' }); // a newer action lands while the rpc is in flight
  await withRecompute(seqRef, r);
  assert.deepEqual(r.order, ['run'], 'kept the optimistic draft — no stale reconcile/commit');
});

test('withRecompute superseded DURING refetch: commit is dropped (the flicker guard)', async () => {
  const seqRef = { current: 0 };
  const r = recorder(seqRef, { bumpOn: 'refetch' }); // newer action starts during the refetch
  await withRecompute(seqRef, r);
  assert.deepEqual(r.order, ['run', 'reconcile', 'refetch'], 'no commit → newer action owns the view');
});

test('withRecompute rpc failure: rollback (still latest) + onError, nothing downstream', async () => {
  const seqRef = { current: 0 };
  const order = [];
  await withRecompute(seqRef, {
    run: async () => { throw Object.assign(new Error('refused'), { code: 'X' }); },
    reconcile: () => order.push('reconcile'),
    refetch: async () => order.push('refetch'),
    commit: () => order.push('commit'),
    rollback: () => order.push('rollback'),
    onError: () => order.push('error'),
  });
  assert.deepEqual(order, ['rollback', 'error'], 'rolled the optimistic patch back and surfaced the refusal');
});

test('withRecompute failure but superseded: NO rollback (a newer action owns state), onError still fires', async () => {
  const seqRef = { current: 0 };
  const order = [];
  await withRecompute(seqRef, {
    run: async () => { seqRef.current++; throw new Error('refused'); }, // newer action landed before the throw
    rollback: () => order.push('rollback'),
    onError: () => order.push('error'),
  });
  assert.deepEqual(order, ['error'], 'did not clobber the newer action’s optimistic state');
});

test('withRecompute reconcile throw is swallowed — commit still runs', async () => {
  const seqRef = { current: 0 };
  const order = [];
  await withRecompute(seqRef, {
    run: async () => 'r',
    reconcile: () => { throw new Error('file cleanup blew up'); },
    refetch: async () => order.push('refetch'),
    commit: () => order.push('commit'),
  });
  assert.deepEqual(order, ['refetch', 'commit'], 'a best-effort reconcile side effect cannot abort the commit');
});

test('withRecompute offline: a failed refetch is swallowed and commit still runs (no rollback)', async () => {
  const seqRef = { current: 0 };
  const order = [];
  await withRecompute(seqRef, {
    run: async () => 'r',
    reconcile: () => order.push('reconcile'),
    refetch: async () => { throw new Error('offline'); },
    commit: () => order.push('commit'),
    rollback: () => order.push('rollback'),
  });
  assert.deepEqual(order, ['reconcile', 'commit'], 'refetch failure neither blocks the commit nor rolls back');
});


// ── Карточки главной: своя сущность, свой ключ ───────────────────────────────
// Соблазн «положить карточку в ключ трипа, она же про тот же трип» — ровно
// грабля TRIP-277: тонкий payload затирает общий кэш, и экран, который ждал
// полный трип, молча получает огрызок. Тест пинит границу.

test('cacheTripCards пишет ТОЛЬКО в ключи карточек и не трогает ключ трипа', () => {
  const writes = [];
  const qc = { setQueryData: (key, val) => writes.push([key, val]) };
  const cards = [{ id: 't1', myStep: 'owner' }, { id: 't2', myStep: 'participant' }];

  cacheTripCards(qc, cards);

  assert.deepEqual(writes.map(([key]) => key), [TRIP_CARD_KEY('t1'), TRIP_CARD_KEY('t2')]);
  const shell = JSON.stringify(TRIP_SHELL_KEY('t1'));
  const content = JSON.stringify(TRIP_CONTENT_KEY('t1'));
  for (const [key] of writes) {
    assert.notEqual(JSON.stringify(key), shell, 'карточка не должна попадать в ключ трипа');
    assert.notEqual(JSON.stringify(key), content, 'карточка не должна попадать в ключ контента');
  }
});

test('cacheTripCards переживает мусор на входе и строки без id', () => {
  const writes = [];
  const qc = { setQueryData: (key) => writes.push(key) };
  cacheTripCards(qc, null);
  cacheTripCards(qc, undefined);
  cacheTripCards(null, [{ id: 't1' }]);
  cacheTripCards(qc, [{ noId: true }, null]);
  assert.deepEqual(writes, []);
});


// ── Факты обвязки: комплект, приоритет и fail-closed ────────────────────────
// Три факта (ступень · аддоны · вердикт Pro) решают состав шапки и меню. Пока
// они лежали тремя строками в экране, из комплекта дважды выпадал один — и меню
// доезжало на глазах при полностью известном составе. Тесты пинят все три сразу.

test('★ дверь ответила — её слово, карточка игнорируется целиком', () => {
  const shell = { trip: { details: { addons: { budget: true } } }, myStep: 'participant', isPro: false };
  const card = { myStep: 'owner', addons: { chat: true }, is_pro: true };
  const f = tripShellFacts(shell, card);
  assert.equal(f.step, 'participant', 'ступень — из двери');
  assert.equal(f.proSeed, false, 'вердикт Pro — из двери');
  assert.equal(f.addons.budget, true);
  assert.equal(f.addons.chat, false, 'аддоны — из двери, не из карточки');
});

// Именно этот случай ослаблял fail-closed в первой редакции: `??` по значению
// откатывал пустую ступень от двери к прошлому доступу из карточки.
test('★ дверь ответила БЕЗ ступени — прав нет, откат к карточке запрещён', () => {
  const f = tripShellFacts({ trip: { details: {} }, myStep: null, isPro: false }, { myStep: 'owner', is_pro: true });
  assert.equal(f.step, null, 'отказ не подменяется прошлым доступом');
});

test('двери нет — все три факта из карточки, аддоны НОРМАЛИЗОВАНЫ', () => {
  // В мешке карточки нарочно truthy-не-true и отсутствующий ключ: без общего
  // нормализатора «включено» посчиталось бы иначе, чем у двери, и меню первого
  // кадра отличалось бы от второго. С однотипным {chat:true} тест был бы зелёным
  // и мимо нормализатора — проверено мутацией.
  const f = tripShellFacts(undefined, { myStep: 'editor', addons: { chat: true, budget: 1 }, is_pro: true });
  assert.equal(f.step, 'editor');
  assert.equal(f.proSeed, true);
  assert.equal(f.addons.chat, true);
  assert.equal(f.addons.budget, false, 'truthy-не-true не включает аддон');
  assert.equal(f.addons.telegram_assistant, false, 'отсутствующий ключ обязан быть в наборе');
});

test('нет ни двери, ни карточки — ступени нет, аддоны выключены, вердикта нет', () => {
  const f = tripShellFacts(undefined, undefined);
  assert.equal(f.step, null);
  assert.equal(f.proSeed, undefined, 'undefined = «ещё не знаем», а не «не Pro»');
  assert.equal(Object.values(f.addons).every((v) => v === false), true);
});

test('★ комплект полон: ни один факт не теряется по дороге', () => {
  for (const f of [
    tripShellFacts({ trip: { details: { addons: {} } }, myStep: 'owner', isPro: true }, undefined),
    tripShellFacts(undefined, { myStep: 'owner', addons: {}, is_pro: true }),
  ]) {
    assert.deepEqual(Object.keys(f).sort(), ['addons', 'proSeed', 'step']);
    assert.equal(f.step, 'owner');
    assert.equal(f.proSeed, true);
    assert.ok(f.addons && typeof f.addons === 'object');
  }
});


// ── ЦЕПОЧКА ЦЕЛИКОМ: главная → кэш → факты → состав меню ────────────────────
//
// Почему этот тест существует. Все части были покрыты по отдельности и зелёные,
// а на экране меню всё равно доезжало: ломались СТЫКИ — сначала рендер смотрел на
// флаг вместо фактов, потом из комплекта выпал Pro. Юнит-тест частей такого не
// видит по построению. Здесь прогоняется весь путь на НАСТОЯЩЕМ QueryClient:
// ответ главной раскладывается по ключам, экран трипа читает СВОЙ ключ, факты
// сливаются, реестр считает состав. Ключи, имена полей и приоритет проверяются
// разом — то есть ровно то, на чём всё спотыкалось.

test('★ путь «главная → трип»: меню полное ДО ответа двери', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const qc = new QueryClient();

  // 1. Главная прочитала карточки (форма — как у getTrips: myStep + addons).
  cacheTripCards(qc, [
    { id: 'trip-1', myStep: 'owner', addons: { budget: true, chat: true }, is_pro: true },
    { id: 'trip-2', myStep: 'participant', addons: {}, is_pro: false },
  ]);

  // 2. Экран трипа читает СВОЙ ключ — про кэш главной он ничего не знает.
  const card = qc.getQueryData(TRIP_CARD_KEY('trip-1'));
  assert.ok(card, 'карточка обязана лежать под своим ключом');

  // 3. Двери ещё нет — факты берутся из карточки...
  const facts = tripShellFacts(undefined, card);
  assert.equal(facts.step, 'owner');
  assert.equal(facts.proSeed, true);

  // 4. ...и состав меню уже ПОЛНЫЙ: ни одного места под неизвестный пункт.
  const lenses = menuSections('lens', facts.addons, facts.step);
  const manage = menuSections('manage', facts.addons, facts.step);
  assert.equal([...lenses, ...manage].some((s) => s.pending), false,
    'при известных фактах заглушек быть не должно');
  assert.deepEqual(lenses.map((s) => s.id),
    ['overview', 'timeline', 'map', 'calendar', 'budget', 'docs', 'chat']);
  assert.deepEqual(manage.map((s) => s.id), ['edit', 'members', 'settings']);
});

test('★ тот же путь для наблюдателя: ролевых пунктов нет, заглушек тоже', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const qc = new QueryClient();
  cacheTripCards(qc, [{ id: 't', myStep: 'participant', addons: {}, is_pro: false }]);

  const facts = tripShellFacts(undefined, qc.getQueryData(TRIP_CARD_KEY('t')));
  const manage = menuSections('manage', facts.addons, facts.step);
  assert.deepEqual(manage.map((s) => s.id), ['settings']);
  assert.equal(manage.some((s) => s.pending), false);
});

test('★ холодный вход (карточки нет): фаза загрузки, а не пустое меню', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const qc = new QueryClient();

  const facts = tripShellFacts(undefined, qc.getQueryData(TRIP_CARD_KEY('nope')));
  const manage = menuSections('manage', facts.addons, facts.step);
  assert.deepEqual(manage.filter((s) => s.pending).map((s) => s.id), ['edit', 'members']);
  assert.ok(manage.some((s) => s.id === 'settings' && !s.pending), 'негейтованный пункт живой');
});

// Настройка живёт в query-client.js и молча теряется при рефакторинге, а её
// потеря не ломает ни один другой тест: карточки просто исчезали бы из кэша
// через 5 минут, и первый кадр меню снова собирался бы из заглушек — но только
// у того, кто задержался на главной. Проверяем явно.
test('★ карточки переживают дефолтный gcTime (иначе фикс живёт 5 минут)', async () => {
  const { queryClientInstance } = await import('./query-client.js');
  const gc = queryClientInstance.getQueryDefaults(TRIP_CARD_KEY('any'))?.gcTime;
  assert.ok(typeof gc === 'number' && gc > 5 * 60 * 1000,
    `карточкам нужен свой gcTime больше дефолтных 5 минут, а он ${gc}`);
});
