/**
 * ★ ГЕЙТ ЧЕРНОВИКА.
 *
 * Ключ хранилища и предикат «есть ли работа» читают ДВОЕ — планировщик и
 * главная. Разъезд между ними не ломает экран: карточка просто не появляется, и
 * дефект невидим. Поэтому оба пинятся здесь, на чистых функциях, — форма та же,
 * что у `stepUrl.test.js` / `routeModel.test.js`.
 *
 * ⚠️ КАЖДАЯ ПРОВЕРКА УВИДЕНА КРАСНОЙ. Мутации, которыми это сделано:
 *   · `draftStorageKey`: выкинуть `draftId` → падает «у каждого черновика СВОЙ ключ»;
 *   · `draftKeyPrefix`: уронить фолбэк `guest` → падает «аноним не делит ключ с null»;
 *   · `draftHasWork`: вернуть `!!saved` → падает «пустая запись — не работа»;
 *   · `draftHasWork`: сравнить `aiMessages.length > 0` → падает «одно приветствие — не работа»;
 *   · `draftHasWork`: снять гейт по `method` → падает «переписка засчитана ручной двери»;
 *   · `draftToCard`: не требовать `id` → падает «без имени карточки нет»;
 *   · `readDrafts`: не фильтровать пустые → падает «пустой черновик карточки не рождает»;
 *   · `readDrafts`: убрать сортировку → падает «свежие сверху»;
 *   · `readDrafts`: не сверять префикс → падает «чужой черновик не виден»;
 *   · `removeDraft`: стирать по префиксу → падает «сносится ТОЛЬКО названный».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKeyPrefix, draftStorageKey, draftHasWork, draftToCard, parseDraft, readDrafts, removeDraft,
  draftPath, draftHref, draftDoorMismatch,
} from './planner-draft.js';

/** Хранилище в памяти — тот же контракт, что у `sessionStorage`, включая перечисление. */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return /** @type {any} */ ({
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });
}

const rec = (over = {}) => JSON.stringify({
  step: 'cities', method: 'manual', savedAt: 1,
  nodes: [{ kind: 'transit', city_name: 'Рим' }], ...over,
});

// ─── ключ ────────────────────────────────────────────────────────────────────
test('draftStorageKey: у каждого черновика СВОЙ ключ, аноним не делит его с юзером', () => {
  assert.notEqual(draftStorageKey('u1', 'a'), draftStorageKey('u1', 'b'));
  assert.notEqual(draftStorageKey('u1', 'a'), draftStorageKey('u2', 'a'));
  assert.equal(draftStorageKey(null, 'a'), draftStorageKey(undefined, 'a'));
  assert.match(draftKeyPrefix(null), /guest/);
});

test('draftStorageKey: имя черновика восстановимо из ключа', () => {
  const k = draftStorageKey('u1', 'abc');
  assert.equal(k.slice(draftKeyPrefix('u1').length), 'abc');
});

// ─── предикат «есть работа» ──────────────────────────────────────────────────
test('draftHasWork: пустая запись — НЕ работа (планировщик пишет её на каждый заход)', () => {
  assert.equal(draftHasWork(null), false);
  assert.equal(draftHasWork({ step: 'home', nodes: [], method: 'manual' }), false);
  assert.equal(draftHasWork({}), false);
});

test('draftHasWork: узлы маршрута — работа для обеих дверей', () => {
  assert.equal(draftHasWork({ method: 'manual', nodes: [{}] }), true);
  assert.equal(draftHasWork({ method: 'ai', nodes: [{}, {}] }), true);
});

test('draftHasWork: переписка — работа ТОЛЬКО у AI и только сверх приветствия', () => {
  const welcomeOnly = { nodes: [], aiMessages: [{ id: 'welcome' }] };
  const talked = { nodes: [], aiMessages: [{ id: 'welcome' }, { id: 'u1' }] };
  assert.equal(draftHasWork({ ...welcomeOnly, method: 'ai' }), false);
  assert.equal(draftHasWork({ ...talked, method: 'ai' }), true);
  assert.equal(draftHasWork({ ...talked, method: 'manual' }), false);
});

// ─── форма карточки ──────────────────────────────────────────────────────────
test('draftToCard: без имени карточки нет — она им адресуется', () => {
  assert.equal(draftToCard(JSON.parse(rec()), ''), null);
  assert.equal(draftToCard(JSON.parse(rec()), undefined), null);
});

test('draftToCard: пустой черновик карточки не рождает', () => {
  assert.equal(draftToCard({ method: 'manual', nodes: [] }, 'a'), null);
  assert.equal(draftToCard(null, 'a'), null);
});

test('draftToCard: несёт имя, дверь, название, обложку и узлы', () => {
  const card = draftToCard(JSON.parse(rec({ tripTitle: '  Лето  ', method: 'ai', savedAt: 7, cover: { cover_image_url: 'u' } })), 'a1');
  assert.equal(card.id, 'a1');
  assert.equal(card.method, 'ai');
  assert.equal(card.title, 'Лето');            // подрезан
  assert.equal(card.savedAt, 7);
  assert.equal(card.cover_image_url, 'u');
  assert.equal(card.nodes.length, 1);
  assert.equal(card.step, undefined);          // шаг несёт восстановление, не карточка
});

test('draftToCard: мусорная дверь читается как ручная, пустые поля — строками', () => {
  const card = draftToCard(JSON.parse(rec({ method: 'нечто', savedAt: undefined })), 'a');
  assert.equal(card.method, 'manual');
  assert.equal(card.title, '');
  assert.equal(card.cover_image_url, '');
  assert.equal(card.savedAt, 0);
});

// ─── разбор и чтение ─────────────────────────────────────────────────────────
test('parseDraft: битая строка = черновика нет', () => {
  assert.equal(parseDraft('{не json'), null);
  assert.equal(parseDraft(''), null);
  assert.equal(parseDraft(null), null);
  assert.deepEqual(parseDraft('{"a":1}'), { a: 1 });
});

test('readDrafts: черновиков может быть сколько угодно, свежие сверху', () => {
  const st = memStorage({
    [draftStorageKey('u1', 'old')]: rec({ savedAt: 1 }),
    [draftStorageKey('u1', 'new')]: rec({ savedAt: 3 }),
    [draftStorageKey('u1', 'mid')]: rec({ savedAt: 2 }),
  });
  assert.deepEqual(readDrafts('u1', st).map(d => d.id), ['new', 'mid', 'old']);
});

test('readDrafts: пустые отброшены, непустые остаются', () => {
  const st = memStorage({
    [draftStorageKey('u1', 'empty')]: rec({ nodes: [] }),
    [draftStorageKey('u1', 'real')]: rec(),
  });
  assert.deepEqual(readDrafts('u1', st).map(d => d.id), ['real']);
});

test('readDrafts: чужой черновик и посторонний ключ не видны', () => {
  const st = memStorage({
    [draftStorageKey('u2', 'x')]: rec(),
    'triplanio-something-else': rec(),
    [draftStorageKey('u1', 'mine')]: rec(),
  });
  assert.deepEqual(readDrafts('u1', st).map(d => d.id), ['mine']);
});

test('readDrafts: без хранилища и на отказе — пусто, а не исключение', () => {
  assert.deepEqual(readDrafts('u1', /** @type {any} */ ({ get length() { throw new Error('denied'); } })), []);
});

test('removeDraft: сносится ТОЛЬКО названный, соседние целы', () => {
  const st = memStorage({
    [draftStorageKey('u1', 'a')]: rec(),
    [draftStorageKey('u1', 'b')]: rec(),
  });
  removeDraft('u1', 'a', st);
  assert.deepEqual(readDrafts('u1', st).map(d => d.id), ['b']);
});

test('removeDraft: без имени не трогает ничего', () => {
  const st = memStorage({ [draftStorageKey('u1', 'a')]: rec() });
  removeDraft('u1', '', st);
  assert.equal(readDrafts('u1', st).length, 1);
});

// ─── дверь черновика ─────────────────────────────────────────────────────────
/* ⚠️ Мутации, которыми эти четыре проверки увидены красными:
 *   · `draftPath`: вернуть '/new-trip' всегда → падает «дверь ИИ ведёт на свой адрес»;
 *   · `draftHref`: выкинуть `encodeURIComponent` → падает «имя экранируется»;
 *   · `draftDoorMismatch`: сравнить сырые `saved.method !== routeMethod` → падает
 *     «запись без поля двери принадлежит ручной» (мусор нормализуется в обе стороны);
 *   · `draftDoorMismatch`: вернуть `true` на пустой записи → падает «нет записи —
 *     нет и несовпадения» (иначе чистый заход увело бы с двери в никуда). */
test('draftPath / draftHref: у каждой двери свой адрес, имя экранируется', () => {
  assert.equal(draftPath('ai'), '/plan-trip-ai');
  assert.equal(draftPath('manual'), '/new-trip');
  assert.equal(draftPath(undefined), '/new-trip');
  assert.equal(draftHref('a b', 'ai'), '/plan-trip-ai?draft=a%20b');
  assert.equal(draftHref('x', 'manual'), '/new-trip?draft=x');
});

test('draftDoorMismatch: чужая дверь опознаётся — иначе ручная стёрла бы переписку ИИ', () => {
  assert.equal(draftDoorMismatch({ method: 'ai' }, 'manual'), true);
  assert.equal(draftDoorMismatch({ method: 'manual' }, 'ai'), true);
  assert.equal(draftDoorMismatch({ method: 'ai' }, 'ai'), false);
  assert.equal(draftDoorMismatch({ method: 'manual' }, 'manual'), false);
});

test('draftDoorMismatch: запись без двери и с мусором — ручная, как и у карточки', () => {
  assert.equal(draftDoorMismatch({}, 'manual'), false);
  assert.equal(draftDoorMismatch({ method: 'нечто' }, 'manual'), false);
  assert.equal(draftDoorMismatch({}, 'ai'), true);
});

test('draftDoorMismatch: записи нет — уводить некуда', () => {
  assert.equal(draftDoorMismatch(null, 'ai'), false);
  assert.equal(draftDoorMismatch(undefined, 'manual'), false);
});
