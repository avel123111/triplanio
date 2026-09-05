// @ts-check
// Подготовка трипа: что из ТЕКУЩЕГО маршрута уже забронировано.
// Знаменатель считается от маршрута (узлы и стыки), а не от броней, поэтому
// бронь между узлами, которые больше не соседи, не покрывает ничего и в счёт не
// попадает. Предикаты общие с лентой (`TimelineLens`), чтобы «нет отеля» там и
// «не забронировано» здесь не разъезжались. Модуль чистый — гоняется `node --test`.

import { parseNaive } from './naive-time.js';
import { sortVisits, sameCity } from './validation.js';

/** Ночей в городе. Отсутствие любой из дат = 0 (нечего бронировать). */
export function cityNights(visit) {
  const s = parseNaive(visit?.start_date);
  const e = parseNaive(visit?.end_date);
  return s && e ? Math.max(0, Math.round(e.diff(s, 'days').days)) : 0;
}

/**
 * Покрывает ли бронь отеля этот город: по `city_visit_id`, а отель без привязки
 * (до TRIP-195 брони создавались без ссылки на визит) — по перекрытию дат.
 */
export function hotelCoversCity(hotel, visit) {
  if (!hotel || !visit) return false;
  if (hotel.city_visit_id) return hotel.city_visit_id === visit.id;
  const ci = parseNaive(hotel.check_in_datetime);
  const co = parseNaive(hotel.check_out_datetime);
  const vs = parseNaive(visit.start_date);
  const ve = parseNaive(visit.end_date);
  if (!ci || !co || !vs || !ve) return false;
  return ci.startOf('day') < ve.startOf('day') && co.startOf('day') > vs.startOf('day');
}

/** Городу нужен отель: не путевая точка и хотя бы одна ночь. */
export function cityNeedsHotel(visit) {
  return visit?.kind !== 'waypoint' && cityNights(visit) >= 1;
}

function transfersForLeg(transfers, from, to) {
  if (!from || !to) return [];
  return (transfers || []).filter(
    (tr) => tr.from_city_visit_id === from.id && tr.to_city_visit_id === to.id,
  );
}

/**
 * Стыки маршрута — пары соседних узлов (старт → города → финиш) с разными
 * городами: «Мадрид → Мадрид» (сплит стоянки) стыком не считается (`sameCity`).
 */
export function routeLegs(visits = []) {
  const ordered = sortVisits(visits);
  const legs = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1];
    const to = ordered[i];
    if (sameCity(from, to)) continue;
    legs.push({ from, to });
  }
  return legs;
}

/**
 * Полная сводка подготовки.
 *
 * @param {{ visits?: any[], hotels?: any[], transfers?: any[] }} src
 * @returns {{
 *   stays: Array<{ key: string, visit: any, nights: number, bookings: any[], booked: boolean }>,
 *   legs: Array<{ key: string, from: any, to: any, bookings: any[], booked: boolean }>,
 *   done: number, total: number,
 * }}
 */
export function buildPreparation({ visits = [], hotels = [], transfers = [] } = {}) {
  const ordered = sortVisits(visits);

  const stays = ordered
    .filter((v) => v.kind !== 'start' && v.kind !== 'end' && cityNeedsHotel(v))
    .map((visit) => {
      const bookings = (hotels || []).filter((h) => hotelCoversCity(h, visit));
      return {
        key: `stay-${visit.id}`,
        visit,
        nights: cityNights(visit),
        bookings,
        booked: bookings.length > 0,
      };
    });

  const legs = routeLegs(ordered).map(({ from, to }) => {
    const bookings = transfersForLeg(transfers, from, to);
    return { key: `leg-${from.id}-${to.id}`, from, to, bookings, booked: bookings.length > 0 };
  });

  const total = stays.length + legs.length;
  const done = stays.filter((s) => s.booked).length + legs.filter((l) => l.booked).length;
  // Доли нет намеренно: `total === 0` — пустое состояние, а не «готово на 100%».
  return { stays, legs, done, total };
}
