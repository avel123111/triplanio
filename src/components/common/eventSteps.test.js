/**
 * ★★ ГЕЙТ ХОДА МАСТЕРА СОЗДАНИЯ СОБЫТИЯ.
 *
 * У хода нет скриншота: «ступень брони появляется ровно при включённом
 * тумблере», «ступень дат непропускаема», «цепочка пересадок держит ВСЕ
 * посегментные токены» — это поведение, и разъедется оно молча. Поэтому карта
 * ступеней вынесена в чистые функции, а гейт — здесь (та же форма проверки, что
 * у `routeModel`, `forkFilter`, `trip-cities`).
 *
 * ⚠️ КАЖДАЯ ПРОВЕРКА УВИДЕНА КРАСНОЙ. Мутации, которыми это сделано:
 *   · `eventSteps`: отдать ступень брони безусловно — падает «брони нет при OFF»;
 *   · `eventSteps`: пометить ступень дат `optional: true` — падает «даты не пропускаются»;
 *   · `eventSteps` (layover): дать цепочке ступень бюджета — падает «у цепочки её НЕТ»;
 *   · `eventSteps`: положить `docs` в ступень бюджета — падает «бюджет — только деньги»;
 *   · `supportsBooked`: пустить активность — падает «у активности тумблера нет»;
 *   · `stepOwnsField`: убрать ветку `segFields` — падает «цепочка держит свои токены»;
 *   · `stepOwnsTimeKey`: сверять только точное совпадение — падает «seg0-dep принадлежит цепочке»;
 *   · `isStepEmpty`: считать пустую строку заполнением — падает «пробелы это пусто»;
 *   · `isStepEmpty`: считать валюту — падает «валюта не в счёт».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventSteps, stepOwnsField, stepOwnsTimeKey, isStepEmpty, supportsBooked, supportsWizard,
} from './eventSteps.js';

const ids = (kind, opts) => eventSteps(kind, opts).map((s) => s.id);
const stepOf = (kind, opts, id) => eventSteps(kind, opts).find((s) => s.id === id);

// ─── Ступень брони = тумблер, и ничто иное ───────────────────────────────────

test('брони нет при выключенном тумблере, есть при включённом', () => {
  assert.deepEqual(ids('hotel'), ['main', 'when', 'budget']);
  assert.deepEqual(ids('hotel', { booked: true }), ['main', 'when', 'booking', 'budget']);
  assert.deepEqual(ids('transfer'), ['main', 'when', 'budget']);
  assert.deepEqual(ids('transfer', { booked: true }), ['main', 'when', 'booking', 'budget']);
});

test('у активности тумблера нет — ступень брони не появляется ни при каком флаге', () => {
  assert.equal(supportsBooked('activity'), false);
  assert.deepEqual(ids('activity', { booked: true }), ['main', 'when', 'budget']);
});

test('мастером идут три вида, услуги остаются полотном', () => {
  assert.equal(supportsWizard('hotel'), true);
  assert.equal(supportsWizard('transfer'), true);
  assert.equal(supportsWizard('activity'), true);
  assert.equal(supportsWizard('service'), false);
});

// ─── Пропуск: только то, без чего событие остаётся событием ──────────────────

test('название и даты непропускаемы, бронь и бюджет пропускаемы', () => {
  const steps = eventSteps('hotel', { booked: true });
  assert.deepEqual(steps.map((s) => s.optional), [false, false, true, true]);
});

test('гейт ступени дат держит оба конца пары и оба ключа времени', () => {
  const when = stepOf('hotel', {}, 'when');
  assert.ok(stepOwnsField(when, 'checkIn') && stepOwnsField(when, 'checkOut'));
  assert.ok(stepOwnsTimeKey(when, 'checkIn') && stepOwnsTimeKey(when, 'checkOut'));
  // Название держит ПЕРВАЯ ступень — иначе «Дальше» на датах молчало бы о нём.
  assert.equal(stepOwnsField(when, 'name'), false);
  assert.equal(stepOwnsField(stepOf('hotel', {}, 'main'), 'name'), true);
});

test('дата бесплатной отмены висит на ступени брони, а не на датах проживания', () => {
  assert.equal(stepOwnsTimeKey(stepOf('hotel', { booked: true }, 'booking'), 'freeCancel'), true);
  assert.equal(stepOwnsTimeKey(stepOf('hotel', { booked: true }, 'when'), 'freeCancel'), false);
});

// ─── Ступень называется тем, что внутри ──────────────────────────────────────

test('заметка — на первой ступени, документы — на броне, бюджет — только деньги', () => {
  const steps = eventSteps('hotel', { booked: true });
  const byId = Object.fromEntries(steps.map((s) => [s.id, s.blocks]));
  assert.ok(byId.main.includes('notes'), 'заметка про событие, она нужна и без брони');
  assert.ok(byId.booking.includes('docs'), 'документ — подтверждение брони');
  assert.equal(byId.main.includes('docs'), false);
  // ★ Главное: в «Бюджете» не должно быть НИЧЕГО, кроме денег — ни дропзоны,
  // ни заметки. Ступень с чужим содержимым врёт своим названием.
  assert.deepEqual(byId.budget, ['money']);
});

test('без брони документов нет ни на одной ступени', () => {
  for (const kind of ['hotel', 'transfer', 'activity']) {
    const blocks = eventSteps(kind).flatMap((s) => s.blocks);
    assert.equal(blocks.includes('docs'), false, kind);
  }
});

// ─── Пересадки: цепочка одной ступенью, и она держит ВСЕ свои токены ─────────

test('у цепочки пересадок ступени бюджета НЕТ — деньги там посегментные', () => {
  assert.deepEqual(ids('transfer', { hasLayovers: true }), ['main', 'when']);
  assert.deepEqual(ids('transfer', { hasLayovers: true, booked: true }), ['main', 'when', 'booking']);
  assert.deepEqual(stepOf('transfer', { hasLayovers: true }, 'when').blocks, ['segments']);
});

test('ступень цепочки держит посегментные токены любого номера', () => {
  const when = stepOf('transfer', { hasLayovers: true }, 'when');
  assert.ok(stepOwnsField(when, 'seg0.start'));
  assert.ok(stepOwnsField(when, 'seg11.toCity'));
  assert.ok(stepOwnsTimeKey(when, 'seg0-dep'), 'ключ времени сегмента пишется через дефис');
  assert.equal(stepOwnsField(when, 'start'), false, 'плоские токены прямого переезда — не её');
});

test('общее у цепочки — ссылка на бронь и файлы, и только при тумблере', () => {
  assert.equal(stepOf('transfer', { hasLayovers: true }, 'booking'), undefined);
  assert.deepEqual(stepOf('transfer', { hasLayovers: true, booked: true }, 'booking').blocks, ['bookingUrl', 'docs']);
});

// ─── «Пропустить» против «Дальше» ────────────────────────────────────────────

test('ступень пуста, пока по её ключам ничего не введено', () => {
  const budget = stepOf('activity', {}, 'budget');
  assert.equal(isStepEmpty(budget, { price: '' }), true);
  assert.equal(isStepEmpty(budget, { price: '   ' }), true, 'пробелы — это пусто');
  assert.equal(isStepEmpty(budget, { price: '12' }), false);
  const booking = stepOf('hotel', { booked: true }, 'booking');
  assert.equal(isStepEmpty(booking, { documents: [] }), true);
  assert.equal(isStepEmpty(booking, { documents: [{ url: 'x' }] }), false, 'приложенный файл — это заполнено');
});

test('валюта не делает ступень заполненной — она приходит дефолтом трипа', () => {
  assert.equal(isStepEmpty(stepOf('activity', {}, 'budget'), { currency: 'EUR' }), true);
});

test('выключенный свитч отмены оставляет ступень брони пустой, включённый — нет', () => {
  const booking = stepOf('hotel', { booked: true }, 'booking');
  assert.equal(isStepEmpty(booking, { free_cancellation: false }), true);
  assert.equal(isStepEmpty(booking, { free_cancellation: true }), false);
});
