/**
 * ★★ ГЕЙТ ПРИМЕНЯТОРА ОПЕРАЦИЙ ИИ (TRIP-527).
 *
 * У поведения «модель правит черновик операциями» нет скриншота: «третий круг
 * правок не пересобирает города», «битая операция пропускается, остальные
 * применяются», «set_route только на пустом» разъедутся молча. Поэтому модуль
 * чистый, а гейт здесь — той же формы, что `routeModel.test.js`.
 *
 * ⚠️ КАЖДАЯ ПРОВЕРКА УВИДЕНА КРАСНОЙ. Мутации:
 *   · `set_route`: снять проверку пустоты — падает «на непустом отказ»;
 *   · `replace_city`: не передать `id` в makeNode — падает «id сохраняется»;
 *   · `applyOps`: не сдвигать курсор городов на отказанном `set_route` —
 *     падает «курсор городов идёт в порядке citiesInOps»;
 *   · `set_start_date`: снять сравнение с today — падает «прошлая дата отказ»;
 *   · `opsJsonSchema`: убрать поле из props — падает «схема покрывает словарь».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPS, REASONS, applyOps, citiesInOps, opShapeError, opsJsonSchema, opsPromptLines,
} from './aiOps.js';
import { makeNode, toDraftPayload, cityNodesOf, refOf, endOf } from './routeModel.js';

const TODAY = '2026-09-07';
const gaz = (name, extra = {}) => ({
  city_name: name, city_name_en: name, country: 'Italy', country_code: 'IT',
  geonameid: name.length, latitude: 1, longitude: 2, timezone: 'Europe/Rome', ...extra,
});
const stop = (name, nights = 2, id = name) => makeNode(gaz(name), 'transit', { id, nights });
const anchor = (name, kind) => makeNode(gaz(name), kind, { id: name });
const st = (nodes, startDate = '2026-10-01', title = '') => ({ nodes, startDate, title });
const names = (nodes) => nodes.map((n) => n.city_name);
const city = (name) => ({ city_name: name, city_name_en: name, country: 'Italy', country_code: 'IT' });

// ─── set_route ───────────────────────────────────────────────────────────────

test('set_route на пустом драфте строит маршрут: старт первый, финиш последний, даты разложены', () => {
  const ops = [{
    op: 'set_route', title: 'Италия', startDate: '2026-10-03',
    nodes: [
      { kind: 'transit', ...city('Рим'), nights: 3 },
      { kind: 'start', ...city('Москва') },
      { kind: 'end', ...city('Москва') },
      { kind: 'transit', ...city('Флоренция'), nights: 2 },
    ],
  }];
  const r = applyOps(st([]), ops, { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Москва', 'Рим', 'Флоренция', 'Москва']);
  assert.equal(r.nodes[0].kind, 'start');
  assert.equal(r.nodes[3].kind, 'end');
  assert.equal(r.title, 'Италия');
  assert.equal(r.startDate, '2026-10-03');
  assert.equal(r.nodes[1].startDate, '2026-10-03');
  assert.equal(r.nodes[2].startDate, '2026-10-06', 'даты города выведены цепочкой');
  assert.deepEqual(r.applied, [{ op: 'set_route' }]);
  assert.deepEqual(r.rejected, []);
});

test('★ set_route на НЕпустом драфте — отказ, узлы не тронуты', () => {
  const before = [stop('Рим')];
  const r = applyOps(st(before), [{ op: 'set_route', nodes: [{ kind: 'transit', ...city('Париж'), nights: 2 }] }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Рим']);
  assert.deepEqual(r.rejected, [{ op: 'set_route', reason: REASONS.route_not_empty }]);
});

test('set_route с прошлой датой: маршрут строится, дата отказана отдельной строкой', () => {
  const r = applyOps(st([], '2026-10-01'), [{ op: 'set_route', startDate: '2020-01-01', nodes: [{ kind: 'transit', ...city('Рим'), nights: 2 }] }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Рим']);
  assert.equal(r.startDate, '2026-10-01', 'дата старта осталась прежней');
  assert.deepEqual(r.rejected, [{ op: 'set_start_date', reason: REASONS.past_date }]);
});

// ─── add / replace / remove / move ───────────────────────────────────────────

test('add_city без after встаёт перед финишем с 3 ночами по умолчанию', () => {
  const r = applyOps(st([anchor('Москва', 'start'), stop('Рим'), anchor('Москва', 'end')]), [{ op: 'add_city', ...city('Милан') }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Москва', 'Рим', 'Милан', 'Москва']);
  assert.equal(r.nodes[2].nights, 3);
  assert.deepEqual(r.applied, [{ op: 'add_city' }]);
});

test('add_city с after — сразу после узла; неизвестный after — отказ', () => {
  const base = [stop('Рим'), stop('Неаполь')];
  const ok = applyOps(st(base), [{ op: 'add_city', ...city('Флоренция'), nights: 1, after: 'Рим' }], { today: TODAY });
  assert.deepEqual(names(ok.nodes), ['Рим', 'Флоренция', 'Неаполь']);
  assert.equal(ok.nodes[1].nights, 1);
  assert.deepEqual(ok.applied, [{ op: 'add_city' }]);
  const bad = applyOps(st(base), [{ op: 'add_city', ...city('Флоренция'), after: 'Париж' }], { today: TODAY });
  assert.deepEqual(names(bad.nodes), ['Рим', 'Неаполь']);
  assert.deepEqual(bad.rejected, [{ op: 'add_city', reason: REASONS.unknown_ref }]);
});

test('add_city с 0 ночей — пересадка, вид следует за ночами', () => {
  const r = applyOps(st([stop('Рим')]), [{ op: 'add_city', ...city('Болонья'), nights: 0 }], { today: TODAY });
  assert.equal(r.nodes[1].kind, 'waypoint');
});

test('★ replace_city сохраняет id, место и ночи, меняет только город', () => {
  const r = applyOps(st([stop('Рим', 3, 'r1'), stop('Канны', 2, 'c1'), stop('Ницца', 1, 'n1')]), [{ op: 'replace_city', ref: 'c1', ...city('Марсель') }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Рим', 'Марсель', 'Ницца']);
  assert.equal(r.nodes[1].id, 'c1');
  assert.equal(r.nodes[1].nights, 2);
  assert.deepEqual(r.applied, [{ op: 'replace_city' }]);
});

test('remove_city убирает узел, в том числе якорь; неизвестный ref — отказ', () => {
  const base = [anchor('Москва', 'start'), stop('Рим'), stop('Неаполь')];
  const r = applyOps(st(base), [{ op: 'remove_city', ref: 'Неаполь' }, { op: 'remove_city', ref: 'Москва' }, { op: 'remove_city', ref: 'x' }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Рим']);
  assert.deepEqual(r.applied, [{ op: 'remove_city' }, { op: 'remove_city' }], 'две записи протокола на два снятых узла');
  assert.deepEqual(r.rejected, [{ op: 'remove_city', reason: REASONS.unknown_ref }]);
});

test('★ add_city с after=финиш кладёт город ПЕРЕД ним: финиш остаётся последним', () => {
  const base = [stop('Рим'), stop('Милан'), anchor('Москва', 'end')];
  const mid = applyOps(st(base), [{ op: 'add_city', ...city('Неаполь'), after: 'Рим' }], { today: TODAY });
  assert.deepEqual(names(mid.nodes), ['Рим', 'Неаполь', 'Милан', 'Москва']);
  const tail = applyOps(st(base), [{ op: 'add_city', ...city('Неаполь'), after: 'Москва' }], { today: TODAY });
  assert.deepEqual(names(tail.nodes), ['Рим', 'Милан', 'Неаполь', 'Москва'], 'финиш остаётся последним');
  assert.equal(endOf(tail.nodes).city_name, 'Москва');
});

test('★ протокол применения = ИМЕНА операций, без словесных подробностей: правда о маршруте одна — `nodes`', () => {
  // Увидено красным: пока в `applied` лежали `city`/`after`/`from`/`to`, у факта
  // «что стало с маршрутом» было два представления, а читатель у второго исчез
  // вместе со строками «что сделал» (TRIP-527).
  const r = applyOps(st([stop('Рим'), stop('Милан')]), [
    { op: 'add_city', ...city('Неаполь'), after: 'Рим' },
    { op: 'set_nights', ref: 'Милан', nights: 4 },
  ], { today: TODAY });
  assert.deepEqual(r.applied, [{ op: 'add_city' }, { op: 'set_nights' }]);
  for (const a of r.applied) assert.deepEqual(Object.keys(a), ['op']);
});

test('move_city: после узла, в начало (после старта), якорь не двигается', () => {
  const base = [anchor('Москва', 'start'), stop('Рим'), stop('Милан'), stop('Неаполь'), anchor('Москва', 'end', )];
  const after = applyOps(st(base), [{ op: 'move_city', ref: 'Неаполь', after: 'Рим' }], { today: TODAY });
  assert.deepEqual(names(after.nodes), ['Москва', 'Рим', 'Неаполь', 'Милан', 'Москва']);
  const first = applyOps(st(base), [{ op: 'move_city', ref: 'Неаполь' }], { today: TODAY });
  assert.deepEqual(names(first.nodes), ['Москва', 'Неаполь', 'Рим', 'Милан', 'Москва']);
  const toEnd = applyOps(st(base), [{ op: 'move_city', ref: 'Рим', after: 'Москва' }], { today: TODAY });
  assert.equal(toEnd.nodes[toEnd.nodes.length - 1].kind, 'end', 'финиш остаётся последним даже при after=финиш');
  const anchorMove = applyOps(st(base), [{ op: 'move_city', ref: 'Москва' }], { today: TODAY });
  assert.deepEqual(anchorMove.rejected, [{ op: 'move_city', reason: REASONS.anchor }]);
  assert.deepEqual(names(anchorMove.nodes), names(base));
});

// ─── ночи, якоря, дата, название ─────────────────────────────────────────────

test('set_nights меняет ночи (0 — пересадка); якорь и отрицательное — отказ', () => {
  const base = [anchor('Москва', 'start'), stop('Рим', 3)];
  const r = applyOps(st(base), [
    { op: 'set_nights', ref: 'Рим', nights: 0 },
    { op: 'set_nights', ref: 'Москва', nights: 2 },
    { op: 'set_nights', ref: 'Рим', nights: -1 },
  ], { today: TODAY });
  assert.equal(r.nodes[1].kind, 'waypoint');
  assert.deepEqual(r.rejected, [
    { op: 'set_nights', reason: REASONS.anchor },
    { op: 'set_nights', reason: REASONS.bad_shape },
  ]);
});

test('set_start/set_end вставляют якорь, повтор — заменяет город на том же id; clear_end убирает финиш', () => {
  let r = applyOps(st([stop('Рим')]), [{ op: 'set_start', ...city('Москва') }, { op: 'set_end', ...city('Москва') }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Москва', 'Рим', 'Москва']);
  const endId = r.nodes[2].id;
  r = applyOps(st(r.nodes), [{ op: 'set_end', ...city('Париж') }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Москва', 'Рим', 'Париж']);
  assert.equal(r.nodes[2].id, endId);
  r = applyOps(st(r.nodes), [{ op: 'clear_end' }, { op: 'clear_end' }], { today: TODAY });
  assert.deepEqual(names(r.nodes), ['Москва', 'Рим']);
  assert.deepEqual(r.rejected, [{ op: 'clear_end', reason: REASONS.unknown_ref }]);
});

test('★ set_start_date: прошлая дата — отказ; будущая — все даты городов переезжают', () => {
  const base = [stop('Рим', 2), stop('Милан', 1)];
  const past = applyOps(st(base), [{ op: 'set_start_date', startDate: '2026-01-01' }], { today: TODAY });
  assert.deepEqual(past.rejected, [{ op: 'set_start_date', reason: REASONS.past_date }]);
  assert.equal(past.startDate, '2026-10-01');
  const ok = applyOps(st(base), [{ op: 'set_start_date', startDate: '2026-11-10' }], { today: TODAY });
  assert.equal(ok.startDate, '2026-11-10');
  assert.equal(ok.nodes[0].startDate, '2026-11-10');
  assert.equal(ok.nodes[1].startDate, '2026-11-12');
});

test('set_title обрезает пробелы; пустое — отказ формы', () => {
  const r = applyOps(st([]), [{ op: 'set_title', title: '  Осень  ' }, { op: 'set_title', title: '   ' }], { today: TODAY });
  assert.equal(r.title, 'Осень');
  assert.deepEqual(r.rejected, [{ op: 'set_title', reason: REASONS.bad_shape }]);
});

// ─── устойчивость ────────────────────────────────────────────────────────────

test('★ битая операция пропускается и сообщается, соседние применяются; пустой ops — просто разговор', () => {
  const r = applyOps(st([stop('Рим')]), [
    { op: 'fly_to_moon' },
    null,
    { op: 'set_nights', ref: 'Рим' },
    { op: 'set_nights', ref: 'Рим', nights: 4 },
  ], { today: TODAY });
  assert.equal(r.nodes[0].nights, 4);
  assert.deepEqual(r.rejected.map((x) => x.reason), [REASONS.unknown_op, REASONS.unknown_op, REASONS.bad_shape]);
  const chat = applyOps(st([stop('Рим')]), [], { today: TODAY });
  assert.deepEqual(chat.applied, []);
  assert.deepEqual(names(chat.nodes), ['Рим']);
});

test('★★ три круга правок не пересобирают нетронутые города: id, geonameid и координаты те же', () => {
  const rome = stop('Рим', 3, 'r1');
  const milan = stop('Милан', 2, 'm1');
  let state = st([rome, milan]);
  state = { ...state, ...applyOps(state, [{ op: 'add_city', ...city('Неаполь'), nights: 2 }], { today: TODAY }) };
  state = { ...state, ...applyOps(state, [{ op: 'set_nights', ref: 'm1', nights: 4 }], { today: TODAY }) };
  state = { ...state, ...applyOps(state, [{ op: 'set_start_date', startDate: '2026-12-01' }], { today: TODAY }) };
  const r = state.nodes.find((n) => n.id === 'r1');
  assert.equal(r.geonameid, rome.geonameid);
  assert.equal(r.latitude, rome.latitude);
  assert.equal(r.timezone, rome.timezone);
  assert.equal(r.nights, 3);
  assert.equal(state.nodes.find((n) => n.id === 'm1').nights, 4);
  assert.deepEqual(names(state.nodes), ['Рим', 'Милан', 'Неаполь']);
});

test('★ курсор городов идёт в порядке citiesInOps, в том числе через отказанный set_route', () => {
  const ops = [
    { op: 'set_route', nodes: [{ kind: 'transit', ...city('Париж'), nights: 2 }] }, // будет отказан (драфт не пуст)
    { op: 'add_city', ...city('Милан') },
    { op: 'set_nights', ref: 'Рим', nights: 1 },
    { op: 'set_end', ...city('Москва') },
  ];
  const wanted = citiesInOps(ops);
  assert.deepEqual(wanted.map((c) => c.city_name), ['Париж', 'Милан', 'Москва']);
  const resolved = wanted.map((c) => gaz(c.city_name, { geonameid: 1000 + c.city_name.length }));
  const r = applyOps(st([stop('Рим')]), ops, { cities: resolved, today: TODAY });
  assert.deepEqual(names(r.nodes), ['Рим', 'Милан', 'Москва']);
  assert.equal(r.nodes[1].geonameid, 1000 + 'Милан'.length, 'add_city взял СВОЙ резолв, а не парижский');
  assert.equal(r.nodes[2].geonameid, 1000 + 'Москва'.length);
});

test('нерезолвленный город добавляется без координат (как ручной ввод), а не отказывается', () => {
  const r = applyOps(st([]), [{ op: 'add_city', ...city('Тмутаракань') }], { today: TODAY });
  assert.equal(r.nodes[0].city_name, 'Тмутаракань');
  assert.equal(r.nodes[0].latitude, null);
  assert.deepEqual(r.rejected, []);
});

// ─── производные от словаря ──────────────────────────────────────────────────

test('★ схема парсера покрывает словарь: enum = все операции, каждое поле каждой операции в properties', () => {
  const schema = opsJsonSchema();
  const item = schema.properties.ops.items;
  assert.deepEqual(item.properties.op.enum, Object.keys(OPS));
  for (const [name, spec] of Object.entries(OPS)) {
    for (const f of Object.keys(spec.fields)) assert.ok(item.properties[f], `${name}.${f} нет в схеме`);
  }
  assert.deepEqual(schema.required, ['ai_comment', 'ops']);
  assert.equal(item.properties.nodes.items.properties.kind.enum.length, 3);
});

test('★ одно имя на один смысл: дата старта у set_route и set_start_date называется одинаково', () => {
  const schema = opsJsonSchema();
  assert.ok(schema.properties.ops.items.properties.startDate, 'startDate в схеме');
  assert.equal(schema.properties.ops.items.properties.date, undefined, 'второго имени для даты старта нет');
  assert.equal(opShapeError({ op: 'set_start_date', startDate: '2026-10-16' }), null);
});

test('★ схема парсера: у узла set_route есть nights (вложенная копия не отстаёт от словаря типов)', () => {
  // Увидено красным: переименование JSON_TYPES.int → number оставило вложенного
  // читателя, и `nights` молча выпадал из схемы (undefined не сериализуется).
  const item = opsJsonSchema().properties.ops.items;
  assert.deepEqual(item.properties.nodes.items.properties.nights, { type: 'integer', minimum: 0 });
});

test('у каждой операции есть строка для промпта, и форма проверяется словарём', () => {
  assert.equal(opsPromptLines().length, Object.keys(OPS).length);
  assert.equal(opShapeError({ op: 'set_nights', ref: 'a', nights: 2 }), null);
  assert.equal(opShapeError({ op: 'set_nights', ref: 'a', nights: '2' }), REASONS.bad_shape);
  assert.equal(opShapeError({ op: 'nope' }), REASONS.unknown_op);
  assert.equal(opShapeError({ op: 'set_route', nodes: [{ kind: 'moon', city_name: 'x' }] }), REASONS.bad_shape);
});

test('toDraftPayload: ref = String(id), ряды без города не едут, координат нет', () => {
  const nodes = [anchor('Москва', 'start'), stop('Рим', 3, 42), makeNode({}, 'transit')];
  const d = toDraftPayload(nodes, '2026-10-01', 'Италия');
  assert.equal(d.startDate, '2026-10-01');
  assert.equal(d.title, 'Италия');
  assert.deepEqual(d.nodes.map((n) => n.ref), ['Москва', '42']);
  assert.equal(d.nodes[1].ref, refOf(nodes[1]));
  assert.deepEqual(Object.keys(d.nodes[1]).sort(), ['city_name', 'city_name_en', 'country_code', 'geonameid', 'kind', 'nights', 'ref']);
  assert.equal(d.nodes[0].nights, null);
  assert.equal(cityNodesOf(nodes).length, 2);
});
