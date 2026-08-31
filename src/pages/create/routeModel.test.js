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
 *   · `withKind('end')`: вернуть `nights: null` — падает «останусь не двигает даты»;
 *   · `toCitiesPayload`: снять дописывание клона старта — падает «домой по умолчанию»;
 *   · `toCitiesPayload`: отдать якорю `nights` — падает «якорь едет без ночей».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insertNode, withNights, withKind, recomputeDates, makeNode, asCity,
  startOf, endOf, hasExplicitEnd, finishOf, isAnchorNode, toCitiesPayload, isStayNode, cityNodesOf,
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
  const w = withKind(t, 'waypoint');
  assert.equal(w.nights, 0, 'плитка «пересадка» обязана обнулить ночи');
  assert.equal(withKind(w, 'transit').nights, 1, 'плитка «посещение» обязана вернуть ночь');
});

test('★★ «останусь» = смена вида, а НЕ выселение: ночи города переживают её', () => {
  const last = stop('Неаполь', 4);
  const stay = withKind(last, 'end');
  assert.equal(stay.kind, 'end');
  assert.equal(stay.nights, 4, 'ночи обнулять нельзя — это молча укоротило бы человеку маршрут');
  assert.equal(withKind(stay, 'transit').nights, 4, 'и возвращаются при обратном переключении');
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

test('★ город-финиш («останусь») ОСТАЁТСЯ в цепочке дат — у него есть ночи', () => {
  const nodes = [stop('Милан', 2), withKind(stop('Неаполь', 3), 'end')];
  const laid = recomputeDates(nodes, '2026-09-01');
  assert.equal(laid[1].startDate, '2026-09-03', 'финиш-город датируется как город, иначе маршрут схлопнется');
});

// ─── Полезная нагрузка: побайтово прежняя ────────────────────────────────────

test('★★ финиш «домой» по умолчанию: узла нет, а в сохранение он едет', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2)];
  assert.equal(hasExplicitEnd(nodes), false, 'молчаливый дефолт не смеет считаться выбранным финишем');
  const payload = toCitiesPayload(nodes);
  assert.deepEqual(payload.map((p) => p.kind), ['start', 'transit', 'end']);
  assert.equal(payload[2].geonameid, payload[0].geonameid, 'дефолтный финиш = клон старта');
});

test('★★ финиш выбран — клон старта НЕ дописывается', () => {
  const nodes = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  assert.equal(hasExplicitEnd(nodes), true);
  const kinds = toCitiesPayload(nodes).map((p) => p.kind);
  assert.deepEqual(kinds, ['start', 'transit', 'end'], 'второго финиша в нагрузке быть не может');
  assert.equal(endOf(nodes).city_name, 'Ницца');
});

test('★★ «останусь» и «выбран другой город» — ОДИН предикат для пропуска шага', () => {
  const stay = [anchor('Рим', 'start'), withKind(stop('Неаполь', 3), 'end')];
  const other = [anchor('Рим', 'start'), stop('Милан', 2), anchor('Ницца', 'end')];
  const none = [anchor('Рим', 'start'), stop('Милан', 2)];
  assert.equal(hasExplicitEnd(stay), true, '«останусь» — тоже выбранный финиш');
  assert.equal(hasExplicitEnd(other), true);
  assert.equal(hasExplicitEnd(none), false, 'не дошёл до выбора — шаг возврата обязан остаться');
  // И «останусь» не плодит клона старта: финиш уже есть.
  assert.equal(toCitiesPayload(stay).filter((p) => p.kind === 'end').length, 1);
});

test('★★ якорь едет БЕЗ ночей, даже когда они у него есть', () => {
  const stay = [anchor('Рим', 'start'), withKind(stop('Неаполь', 3), 'end')];
  const [start, end] = toCitiesPayload(stay);
  assert.ok(!('nights' in start), 'у старта ночей в нагрузке не было и не должно быть');
  assert.ok(!('nights' in end), 'город-финиш сохраняется якорем — так было до переезда, дословно');
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
  assert.deepEqual(toCitiesPayload(nodes).map((p) => p.kind), ['start', 'end']);
});

test('★ якорь опознаётся по виду, а не по месту в списке', () => {
  assert.equal(isAnchorNode({ kind: 'start' }), true);
  assert.equal(isAnchorNode({ kind: 'end' }), true);
  assert.equal(isAnchorNode({ kind: 'transit' }), false);
  assert.equal(isAnchorNode({ kind: 'waypoint' }), false);
});

// ─── Кто «город» для карты и ревью ───────────────────────────────────────────

test('★★ «останусь» считается ГОРОДОМ, финиш-отдельный город — НЕ считается', () => {
  const stay = withKind(stop('Неаполь', 3), 'end');
  const term = anchor('Ницца', 'end');
  assert.equal(isStayNode(stay), true, 'в нём ночуют — значит это город');
  assert.equal(isStayNode(term), false, 'терминал без ночей городом списка не является');

  const withStay = [anchor('Рим', 'start'), stop('Милан', 2), stay];
  const withTerm = [anchor('Рим', 'start'), stop('Милан', 2), term];
  assert.deepEqual(cityNodesOf(withStay).map((n) => n.city_name), ['Милан', 'Неаполь']);
  assert.deepEqual(cityNodesOf(withTerm).map((n) => n.city_name), ['Милан'],
    'иначе карта нарисует финиш дважды: пином города и пином финиша');
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

test('★★ снятие финиша с города возвращает вид ПО НОЧАМ, а не «посещение» всегда', () => {
  // Пересадку (0 ночей) можно пометить финишем — и снятие обязано вернуть её
  // пересадкой. `withKind(n,'transit')` дал бы ночь и превратил бы её в ночёвку.
  const wpStay = withKind(stop('Генуя', 0), 'end');
  assert.equal(asCity(wpStay).kind, 'waypoint');
  assert.equal(asCity(wpStay).nights, 0);
  const cityStay = withKind(stop('Неаполь', 3), 'end');
  assert.equal(asCity(cityStay).kind, 'transit');
  assert.equal(asCity(cityStay).nights, 3, 'ночи города переживают оба переключения');
});

// ─── Где финиш: ОДИН ответ на весь флоу ──────────────────────────────────────

test('★★ finishOf различает четыре формы, и «домой» выбором НЕ считается', () => {
  const start = anchor('Москва', 'start');
  const rome = stop('Рим');
  assert.deepEqual(
    ['none', 'home', 'city', 'stay'].map((m, i) => {
      const nodes = [[], [start], [start, rome, anchor('Париж', 'end')],
        [start, withKind(rome, 'end')]][i];
      const f = finishOf(nodes);
      return [f.mode, f.decided];
    }),
    [['none', false], ['home', false], ['city', true], ['stay', true]],
  );
});

test('★★ «останусь» ОДИНАКОВО читается всеми: и финиш, и город списка', () => {
  // Расхождение здесь и было багом: шаг возврата помечал город финишем, шаг
  // городов рисовал его обычным городом, а шаг пропускался как «финиш выбран».
  const nodes = [anchor('Москва', 'start'), withKind(stop('Рим'), 'end')];
  const f = finishOf(nodes);
  assert.equal(f.mode, 'stay');
  assert.equal(f.decided, true, 'выбор сделан — иначе шаг возврата не пропустится');
  assert.ok(isStayNode(f.node), 'узел остаётся городом с ночами');
  assert.deepEqual(cityNodesOf(nodes).map(n => n.city_name), ['Рим'],
    'город из списка не исчезает оттого, что он же финиш');
});
