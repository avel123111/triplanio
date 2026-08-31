/**
 * ★★ ГЕЙТ МОДЕЛИ МАРШРУТА ВИЗАРДА (TRIP-484 §4).
 *
 * У маршрута нет скриншота: «финиш всегда последний», «ночи и вид не могут
 * разойтись», «шаг возврата пропускается ровно тогда, когда финиш выбран» —
 * это поведение, и разъедется оно молча. Поэтому модель вынесена в чистые
 * функции, а гейт — здесь: ровно та форма проверки, что уже принята в репо для
 * поведения без скриншота (`forkFilter`, `trip-cities`, `loadStateClassify`).
 *
 * ⚠️ ГЛАВНОЕ, ЧТО СТОРОЖИТ ЭТОТ ФАЙЛ, — ПЕРЕЕЗД БЕЗ СМЕЩЕНИЯ. Модель сменилась
 * (три переменные -> один список), а полезная нагрузка сохранения и даты обязаны
 * остаться теми же на тех же данных. Проверки ниже пинят именно это, а не
 * красоту новой модели.
 *
 * ⚠️ КАЖДАЯ ПРОВЕРКА УВИДЕНА КРАСНОЙ. Мутации, которыми это сделано:
 *   · `insertNode`: `end` вставлять `unshift` вместо `push` — падает «финиш последний»;
 *   · `insertNode`: снять гейт по занятому виду — падает «второго якоря не бывает»;
 *   · `withNights`: убрать смену `kind` — падает «ночи и вид не расходятся»;
 *   · `withNights`: дать ночи якорю — падает «у финиша ночей не бывает»;
 *   · `toCitiesPayload`: дописать клон старта — падает «нет узла = кончается городом»;
 *   · `toCitiesPayload`: отдать якорю `nights` — падает «якорь едет без ночей»;
 *   · `cityNodesOf`: пустить якорь в города — падает «финиш не город списка».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insertNode, withNights, recomputeDates, makeNode,
  startOf, endOf, hasExplicitEnd, isAnchorNode, toCitiesPayload, cityNodesOf,
} from './routeModel.js';

const city = (name, extra = {}) => ({
  id: name, city_name: name, city_name_en: name, country_code: 'IT',
  geonameid: name.length, external_city_id: String(name.length), name_i18n: null,
  latitude: 1, longitude: 2, timezone: 'Europe/Rome', ...extra,
});
const stop = (name, nights = 2) => city(name, { kind: nights === 0 ? 'waypoint' : 'transit', nights });
const anchor = (name, kind) => city(name, { kind, nights: null });

// ─── Порядок: финиш последний по ПОСТРОЕНИЮ ──────────────────────────────────

test('★ финиш всегда последний: город, добавленный после него, встаёт ПЕРЕД', () => {
  let nodes = [anchor('Рим', 'start')];
  nodes = insertNode(nodes, stop('Милан'));
  nodes = insertNode(nodes, anchor('Ницца', 'end'));
  nodes = insertNode(nodes, stop('Турин'));   // добавлен ПОСЛЕ финиша
  nodes = insertNode(nodes, stop('Генуя', 0)); // и пересадка тоже
  assert.deepEqual(nodes.map((n) => n.city_name), ['Рим', 'Милан', 'Турин', 'Генуя', 'Ницца']);
  assert.equal(nodes[nodes.length - 1].kind, 'end', 'финиш обязан остаться замыкающим');
});

test('★ старт всегда первый, даже если добавлен последним', () => {
  let nodes = [stop('Милан'), stop('Турин')];
  nodes = insertNode(nodes, anchor('Рим', 'start'));
  assert.equal(nodes[0].city_name, 'Рим');
  assert.equal(startOf(nodes).city_name, 'Рим');
});

test('★ второго якоря не бывает: занятый вид отказывает вставкой, а не молча', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан'), anchor('Ницца', 'end')];
  assert.equal(insertNode(nodes, anchor('Бари', 'start')), null, 'второй старт обязан быть отказан');
  assert.equal(insertNode(nodes, anchor('Бари', 'end')), null, 'второй финиш обязан быть отказан');
  // Отказ не портит исходный список — вызыватель показывает тост и живёт дальше.
  assert.equal(nodes.length, 3);
});

// ─── Ночи и вид: один факт, две ручки ────────────────────────────────────────

test('★★ ночи и вид не могут разойтись: ноль ночей ЕСТЬ пересадка, в обе стороны', () => {
  const t = stop('Милан', 3);
  assert.equal(withNights(t, 0).kind, 'waypoint', 'степпер увёл ночи в ноль — вид обязан стать пересадкой');
  assert.equal(withNights(withNights(t, 0), 2).kind, 'transit', 'ночи вернулись — вид тоже');
});

test('★★ У ФИНИША НОЧЕЙ НЕ БЫВАЕТ: якорь степперу не поддаётся', () => {
  // Прежняя редакция помечала последний город финишем, СОХРАНЯЯ ему ночи, — и
  // этим заводила второй вид финиша (у одного ночей нет, у другого три).
  const end = makeNode(city('Ницца'), 'end');
  assert.equal(end.nights, null, 'финиш родится без ночей');
  assert.equal(withNights(end, 3).nights, null, 'и ночей ему не выдать');
});

// ─── Даты: переезд не сместил ни одной ───────────────────────────────────────

test('★★ даты цепочки те же, что до переезда: якоря в цепочку не входят', () => {
  const nodes = [
    anchor('Рим', 'start'),
    stop('Милан', 2), stop('Генуя', 0), stop('Турин', 3),
    anchor('Ницца', 'end'),
  ];
  const laid = recomputeDates(nodes, '2026-09-01');
  const byName = Object.fromEntries(laid.map((n) => [n.city_name, n.startDate]));
  assert.equal(byName['Милан'], '2026-09-01', 'первый город садится ровно на дату старта трипа');
  assert.equal(byName['Генуя'], '2026-09-03', 'после двух ночей');
  assert.equal(byName['Турин'], '2026-09-03', 'пересадка (0 ночей) курсор не двигает');
  assert.equal(laid[0].startDate, undefined, 'у старта дат нет — он не в цепочке');
  assert.equal(laid[laid.length - 1].startDate, undefined, 'и у финиша тоже');
});

test('★ «останусь» = финиша нет, и цепочка дат кончается последним городом', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), stop('Неаполь', 3)];
  const laid = recomputeDates(nodes, '2026-09-01');
  assert.equal(laid[2].startDate, '2026-09-03', 'последний город датируется как город');
  assert.equal(endOf(nodes), null, 'узла финиша нет — рисовать и сохранять нечего');
  assert.deepEqual(cityNodesOf(nodes).map((n) => n.city_name), ['Милан', 'Неаполь']);
});

// ─── Полезная нагрузка: побайтово прежняя ────────────────────────────────────

test('★★ НЕТ УЗЛА ФИНИША ⇒ маршрут кончается последним городом (дефолт «домой» снят)', () => {
  // Прежде здесь дописывался клон старта, и «не выбрал» молча значило «домой».
  // Именно из-за этого «останусь» приходилось помечать на узле — иначе оно было
  // неотличимо от «не выбрал». Решение Pavel: возврат домой = ЯВНЫЙ узел.
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2)];
  assert.equal(hasExplicitEnd(nodes), false);
  assert.deepEqual(toCitiesPayload(nodes).map((p) => p.kind), ['start', 'transit']);
});

test('★★ «домой» — ЯВНЫЙ узел, и он такой же, как любой другой финиш', () => {
  const start = anchor('Рим', 'start');
  const nodes = [start, stop('Милан', 2), makeNode(start, 'end')];
  const payload = toCitiesPayload(nodes);
  assert.deepEqual(payload.map((p) => p.kind), ['start', 'transit', 'end']);
  assert.equal(payload[2].geonameid, payload[0].geonameid, '«домой» = тот же город, что старт');
  assert.equal(endOf(nodes).nights, null, 'и ночей у него нет, как у любого финиша');
});

test('★★ финиш выбран — клон старта НЕ дописывается', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  assert.equal(hasExplicitEnd(nodes), true);
  const kinds = toCitiesPayload(nodes).map((p) => p.kind);
  assert.deepEqual(kinds, ['start', 'transit', 'end'], 'второго финиша в нагрузке быть не может');
  assert.equal(endOf(nodes).city_name, 'Ницца');
});

test('★★ шаг возврата пропускается ровно тогда, когда узел финиша ЕСТЬ', () => {
  const other = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  const stay = [anchor('Рим', 'start'), stop('Милан', 2)];
  assert.equal(hasExplicitEnd(other), true);
  assert.equal(hasExplicitEnd(stay), false, '«останусь» — отсутствие финиша, шаг обязан остаться');
});

test('★★ якорь едет БЕЗ ночей, даже когда они у него есть', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  const [start, , end] = toCitiesPayload(nodes);
  assert.ok(!('nights' in start), 'у старта ночей в нагрузке не было и не должно быть');
  assert.ok(!('nights' in end), 'и у финиша тоже — он якорь');
});

test('★ проекция ПОИМЁННАЯ: служебные поля модели наружу не текут', () => {
  const nodes = [stop('Милан', 2)];
  const [row] = toCitiesPayload(recomputeDates(nodes, '2026-09-01'));
  for (const leaked of ['id', 'startDate', 'city_name', 'country']) {
    assert.ok(!(leaked in row), `поле «${leaked}» не входит в контракт создания трипа`);
  }
  assert.deepEqual(Object.keys(row).sort(), [
    'city_name_en', 'country_code', 'external_city_id', 'geonameid',
    'kind', 'latitude', 'longitude', 'name_i18n', 'nights', 'timezone',
  ]);
});

test('★ безымянный ряд (только что добавленный, город ещё не выбран) в нагрузку не едет', () => {
  const nodes = [anchor('Рим', 'start'), { id: 9, kind: 'transit', nights: 3, city_name: '' }];
  assert.deepEqual(toCitiesPayload(nodes).map((p) => p.kind), ['start']);
});

test('★ якорь опознаётся по виду, а не по месту в списке', () => {
  assert.equal(isAnchorNode({ kind: 'start' }), true);
  assert.equal(isAnchorNode({ kind: 'end' }), true);
  assert.equal(isAnchorNode({ kind: 'transit' }), false);
  assert.equal(isAnchorNode({ kind: 'waypoint' }), false);
});

// ─── Кто «город» для карты и ревью ───────────────────────────────────────────

test('★★ финиш НИКОГДА не город списка — иначе карта нарисует его дважды', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  assert.deepEqual(cityNodesOf(nodes).map((n) => n.city_name), ['Милан'],
    'пином города И пином финиша — ровно это и рисовал прежний второй вид финиша');
});

test('★ фабрика узла: ночи выдаёт ВИД, а не вызыватель', () => {
  const c = { city_name: 'Рим', country_code: 'IT', geonameid: 3169070 };
  assert.equal(makeNode(c, 'start').nights, null, 'у якоря ночей нет');
  assert.equal(makeNode(c, 'end').nights, null);
  assert.equal(makeNode(c, 'waypoint').nights, 0, 'пересадка — это ноль ночей');
  assert.equal(makeNode(c, 'transit').nights, 3, 'город по умолчанию — три ночи, как было');
  assert.equal(makeNode(c, 'transit', { nights: 5 }).nights, 5);
  // Пустой город (ряд без выбора) форму не ломает — просто не поедет в нагрузку.
  assert.equal(makeNode(null, 'transit').city_name, '');
});


// ─── Финиш — один объект ─────────────────────────────────────────────────────

test('★★ ФИНИШ НЕ ГОРОД СПИСКА: он якорь, и в города не попадает', () => {
  // Ровно этим и был зоопарк: «останусь» лежало в списке городом с ночами и
  // бейджем, а выбранный плиткой финиш — якорём без ночей. Один объект.
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  assert.deepEqual(cityNodesOf(nodes).map((n) => n.city_name), ['Милан']);
  assert.ok(isAnchorNode(endOf(nodes)));
});
