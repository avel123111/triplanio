// @ts-check
/**
 * Событие потока → ОТРЕЗКИ ПО ДНЯМ для календаря.
 *
 * ★ ДЛИТЕЛЬНОСТЬ — ЭТО ДАННЫЕ, А НЕ ОФОРМЛЕНИЕ. Календарь рисовал каждое
 * событие часом от начала (`startMin + 60`), поэтому активность 10:00–12:00
 * занимала на сетке один час, а пересечения считались по выдуманному интервалу:
 * событие 10:00–10:30 «занимало» до 11:00 и ложно жалось с соседом в 10:45, а
 * активность 10:00–14:00, наоборот, не замечала перелёта в 12:00. Поле
 * `endTime` поток кладёт с самого начала («to size blocks by real duration
 * instead of a fixed guess») — экран его просто не читал.
 *
 * ★ ДВА КЛАССА ОБЪЕКТОВ, И ЭТО РЕШЕНИЕ, А НЕ УМОЛЧАНИЕ (Pavel, 2026-08-29):
 *   · ИНТЕРВАЛ — активность и переезд (`activity`/`flight`/`transfer`). Конец у
 *     них есть всегда: валидатор требует его (`ACT_END_REQUIRED`,
 *     `TR_ARR_REQUIRED`) и требует `end > start`. Рисуем от начала до конца.
 *   · МОМЕНТ — заезд, выезд, дедлайн отмены, выдача и возврат авто. Своей
 *     длительности у них НЕТ по природе объекта (заезд не «длится»), поэтому им
 *     назначен ровно час от указанного времени.
 * Список типов — явный, а не «есть ли `endTime`»: правило принято по СМЫСЛУ
 * объекта, и появление конца у брони отеля не должно молча растянуть заезд.
 *
 * ★ ЧЕРЕЗ ПОЛНОЧЬ — ДВА ОТРЕЗКА, а не потерянный хвост. Событие живёт в дне
 * СТАРТА (`e.date`), поэтому ночной перелёт 23:00→07:00 либо вылезал за низ
 * сетки, либо в дне прилёта его не было вовсе. Интервал режется по суткам:
 * конец первого дня + начало следующего (решение Pavel). Выдуманный час МОМЕНТА
 * через полночь НЕ продолжается — он обрезается концом суток: рисовать «заезд»
 * в следующем дне значит показывать событие, которого там нет.
 *
 * Единица — минуты от полуночи СВОЕГО дня; день назван ключом `yyyy-LL-dd`,
 * тем же, каким `buildEventStream` метит событие.
 */
import { DateTime } from 'luxon';

/** Минут в сутках. */
export const DAY_MIN = 1440;
/** Час, которым рисуется МОМЕНТ (решение Pavel). */
export const POINT_MIN = 60;
/** Потолок разреза: защита от кривых данных («конец» через два года). */
const DAY_CAP = 32;

/** Типы, у которых длительность — данные. Остальные — моменты. */
const INTERVAL_TYPES = new Set(['activity', 'flight', 'transfer']);

/** «HH:mm» → минуты от полуночи; null, если времени нет. */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const h = +m[1], min = +m[2];
  // Регексп ловит только цифры, отрицательных тут не бывает — проверяем верхние
  // границы (24:00 и 12:60 временем не являются). Сравнения ОДНОСТОРОННИЕ ещё и
  // потому, что пара `>` … `<` в одной строке читается сканером гарда 2d как
  // JSX-текст (та же ловушка, что у `visitCoversDay` в CalendarLens).
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Разница в днях между ключами `yyyy-LL-dd`; null, если ключ не разобран. */
function daysBetween(fromKey, toKey) {
  const a = DateTime.fromISO(fromKey, { zone: 'utc' });
  const b = DateTime.fromISO(toKey, { zone: 'utc' });
  if (!a.isValid || !b.isValid) return null;
  return Math.round(b.startOf('day').diff(a.startOf('day'), 'days').days);
}

/**
 * Длительность события в минутах. У интервала — реальная, у момента — час.
 * Кривые данные (конца нет, конец раньше начала, конец не разобран) падают на
 * час: без длительности блока не существует, а терять событие нельзя.
 * @param {{ type?: string, date?: string, time?: string, endDate?: string|null, endTime?: string|null }} ev
 * @param {number} from начало события в минутах от полуночи его дня
 */
export function eventDuration(ev, from) {
  if (!INTERVAL_TYPES.has(ev?.type || '')) return POINT_MIN;
  const endMin = minutesOf(ev?.endTime);
  if (endMin === null || !ev?.endDate || !ev?.date) return POINT_MIN;
  const days = daysBetween(ev.date, ev.endDate);
  if (days === null || days < 0) return POINT_MIN;
  const total = days * DAY_MIN + endMin - from;
  return total > 0 ? total : POINT_MIN;
}

/**
 * @typedef {{ dateKey: string, from: number, to: number,
 *             contPrev: boolean, contNext: boolean }} DaySegment
 */

/**
 * Отрезки события по дням. Пусто, если у события нет дня или времени (такое
 * едет в полосу «весь день», а не на ось часов).
 * @param {{ type?: string, date?: string, time?: string, endDate?: string|null, endTime?: string|null }} ev
 * @returns {DaySegment[]}
 */
export function eventSegments(ev) {
  const dayKey = ev?.date;
  const from = minutesOf(ev?.time);
  if (!dayKey || from === null) return [];

  const start = DateTime.fromISO(dayKey, { zone: 'utc' });
  if (!start.isValid) return [];

  const isPoint = !INTERVAL_TYPES.has(ev?.type || '');
  const startAbs = from;
  const rawEnd = from + eventDuration(ev, from);
  // Момент не переносится через полночь: его час — назначенный, а не данные.
  const endAbs = isPoint ? Math.min(rawEnd, DAY_MIN) : rawEnd;

  /** @type {DaySegment[]} */
  const segs = [];
  for (let d = 0; d < DAY_CAP; d++) {
    const dayFrom = d * DAY_MIN;
    if (endAbs <= dayFrom) break;
    const segFrom = Math.max(startAbs, dayFrom) - dayFrom;
    const segTo = Math.min(endAbs, dayFrom + DAY_MIN) - dayFrom;
    if (segTo <= segFrom) break;
    segs.push({
      dateKey: start.plus({ days: d }).toFormat('yyyy-LL-dd'),
      from: segFrom,
      to: segTo,
      contPrev: d > 0,
      contNext: endAbs > dayFrom + DAY_MIN,
    });
  }
  return segs;
}
