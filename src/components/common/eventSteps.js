// Ход мастера создания события: КАРТА СТУПЕНЕЙ, и только она.
//
// Это раскладка ОДНОЙ И ТОЙ ЖЕ формы (`EventEditDialog`), а не вторая форма:
// состояние, валидация, payload-сборщики и запись остаются там. Здесь —
// чистые данные о том, какие блоки полей показываются на какой ступени, какие
// токены валидации ступень держит и можно ли её пропустить. Модуль намеренно
// БЕЗ React и без иконок: тесты гоняет `node --test`, а импорт lucide его
// роняет (та же причина, по которой `trip-cities.js` держат чистым).
//
// ★ Пошагово только СОЗДАНИЕ и только три вида (отель / переезд / активность).
// Правка остаётся полотном — туда приходят за одним полем, мастер там мешает;
// услуги (аренда/eSIM/страховка) в этот ход не входят вовсе.
//
// ⚠ Ступень «Бронь» существует, только когда включён тумблер «уже
// забронировано». Тумблер живёт на ПЕРВОЙ ступени и виден всегда, поэтому
// исчезнувшая ступень не делает решение необратимым (урок TRIP-484): вернуться
// на первую ступень можно тапом по рейлу, и ступень зажигается обратно.

/** Виды, у которых есть тумблер «уже забронировано». У активности полей брони
 *  нет ни одного (в `activities` нет ни `booking_reference`, ни `booking_url`),
 *  поэтому тумблер там был бы переключателем, который ничего не переключает. */
export const supportsBooked = (kind) => kind === 'hotel' || kind === 'transfer';

/** Виды, идущие мастером. Всё остальное (`service`) рисует полотно. */
export const supportsWizard = (kind) => kind === 'hotel' || kind === 'transfer' || kind === 'activity';

const BUDGET_VALUES = ['price', 'documents', 'notes'];

/**
 * Ступени хода для вида.
 *
 * Ступень = { id, labelKey, blocks, fields, timeKeys, values, optional }:
 *  • `blocks`   - имена блоков полей, которые рисует форма (её реестр);
 *  • `fields`   - токены валидации, за которые отвечает ступень (гейт «Дальше»);
 *  • `segFields`- ступень держит ВСЕ посегментные токены (`seg0.start` …);
 *  • `timeKeys` - ключи «дата без времени» ступени (тот же гейт);
 *  • `values`   - ключи формы, по которым считается «ступень пуста» (для
 *                 «Пропустить» вместо «Дальше»);
 *  • `optional` - ступень можно пропустить, ничего не заполняя.
 *
 * @param {string} kind
 * @param {{ booked?: boolean, hasLayovers?: boolean }} [opts]
 */
export function eventSteps(kind, { booked = false, hasLayovers = false } = {}) {
  if (kind === 'hotel') {
    return [
      { id: 'main', labelKey: 'event.step_hotel', blocks: ['identity'], fields: ['name'] },
      { id: 'when', labelKey: 'event.step_stay', blocks: ['dates'], fields: ['checkIn', 'checkOut'], timeKeys: ['checkIn', 'checkOut'] },
      ...(booked ? [{
        id: 'booking',
        labelKey: 'event.step_booking',
        blocks: ['booking', 'cancel'],
        timeKeys: ['freeCancel'],
        values: ['booking_url', 'booking_reference', 'phone', 'email', 'free_cancellation'],
        optional: true,
      }] : []),
      { id: 'budget', labelKey: 'event.step_budget', blocks: ['money', 'docs'], values: [...BUDGET_VALUES, 'payment_status'], optional: true },
    ].map(withDefaults);
  }

  if (kind === 'transfer') {
    // Пересадки: сегмент - цельная сущность (транспорт + два адреса + два
    // времени + перевозчик + цена), резать её по ступеням нельзя, а «ступень на
    // сегмент» гнала бы число ступеней прямо под рейлом прогресса. Поэтому
    // цепочка идёт одной ступенью-списком (карточки свёрнуты, открыта одна).
    if (hasLayovers) {
      return [
        { id: 'main', labelKey: 'event.step_route', blocks: ['legMode'] },
        { id: 'when', labelKey: 'event.step_segments', blocks: ['segments'], segFields: true },
        {
          id: 'budget',
          labelKey: 'event.step_budget',
          // Цены при пересадках живут ВНУТРИ карточек сегментов (так их и пишет
          // `saveLayoverChain`), поэтому общая ступень денег несёт только то, что
          // у цепочки общее: ссылку на бронь, файлы и заметку.
          blocks: [...(booked ? ['bookingUrl'] : []), 'docs'],
          values: ['booking_url', 'documents', 'notes'],
          optional: true,
        },
      ].map(withDefaults);
    }
    return [
      { id: 'main', labelKey: 'event.step_transport', blocks: ['legMode', 'legPlaces'] },
      { id: 'when', labelKey: 'event.step_time', blocks: ['legTime'], fields: ['start', 'end'], timeKeys: ['start', 'end'] },
      ...(booked ? [{
        id: 'booking',
        labelKey: 'event.step_booking',
        blocks: ['legCarrier', 'legRef', 'bookingUrl'],
        values: ['carrier', 'flight_number', 'booking_reference', 'booking_url'],
        optional: true,
      }] : []),
      { id: 'budget', labelKey: 'event.step_budget', blocks: ['legPrice', 'docs'], values: BUDGET_VALUES, optional: true },
    ].map(withDefaults);
  }

  // activity
  return [
    { id: 'main', labelKey: 'event.step_activity', blocks: ['identity'], fields: ['title'] },
    { id: 'when', labelKey: 'event.step_when', blocks: ['dates'], fields: ['start', 'end'], timeKeys: ['start', 'end'] },
    { id: 'budget', labelKey: 'event.step_budget', blocks: ['money', 'docs'], values: BUDGET_VALUES, optional: true },
  ].map(withDefaults);
}

function withDefaults(s) {
  return { fields: [], timeKeys: [], values: [], segFields: false, optional: false, ...s };
}

const isSegToken = (name) => /^seg\d+[.-]/.test(String(name || ''));

/** Держит ли ступень этот токен валидации. */
export function stepOwnsField(step, field) {
  if (!step || !field) return false;
  if (step.segFields && isSegToken(field)) return true;
  return step.fields.includes(field);
}

/** Держит ли ступень этот ключ «дата без времени» (`timeMissing`). */
export function stepOwnsTimeKey(step, key) {
  if (!step || !key) return false;
  if (step.segFields && isSegToken(key)) return true;
  return step.timeKeys.includes(key);
}

/** Ничего ли не введено на ступени - тогда её primary читается «Пропустить».
 *  Валюта в счёт не идёт: она приходит с дефолтом трипа, а не от пользователя. */
export function isStepEmpty(step, form = {}) {
  if (!step) return true;
  return !step.values.some((k) => {
    const v = form[k];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'boolean') return v;
    return v != null && String(v).trim() !== '';
  });
}
