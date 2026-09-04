// @ts-check
// Подготовка трипа — «что из ТЕКУЩЕГО маршрута уже забронировано».
//
// ★ ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Предикаты «городу нужен отель» и «на стыке нет
// переезда» жили ВНУТРИ `TimelineLens` замыканиями (`cityNeedsHotel`,
// `hasTransferBetween`). Виджету «Подготовка» на Обзоре нужны ровно они же, и
// вторая копия немедленно разъехалась бы с лентой: варнинг в ленте есть, а
// прогресс-бар его не считает (или наоборот) — расхождение молчаливое, ни один
// гард его не видит. Поэтому предикаты подняты сюда, а лента их импортирует.
//
// ★★ ЗНАМЕНАТЕЛЬ СЧИТАЕТСЯ ОТ МАРШРУТА, А НЕ ОТ БРОНЕЙ. Мы идём по узлам
// маршрута и спрашиваем «покрыт ли этот ночлег / этот стык», а не перебираем
// брони. Из этого само собой следует требование «отмершие брони не
// учитываются»: переезд между городами, которые в маршруте больше не соседи
// (`TR_NOT_ADJACENT` у валидатора), не покрывает НИ ОДИН стык, поэтому он не
// попадает ни в числитель, ни в знаменатель — его просто нет в обходе. То же с
// отелем, не привязанным ни к одному городу. Считать наоборот («сколько броней
// у трипа») означало бы, что удалённый из маршрута город продолжает давать
// «100% готово».
//
// Модуль ЧИСТЫЙ (без React/DOM/i18n) — гоняется в `node --test`, как
// `trip-cities.js` и `warningDismissals.js`.

import { parseNaive } from './naive-time.js';
import { sortVisits, cityIdentity } from './validation.js';

/** Ночей в городе. Отсутствие любой из дат = 0 (нечего бронировать). */
export function cityNights(visit) {
  const s = parseNaive(visit?.start_date);
  const e = parseNaive(visit?.end_date);
  return s && e ? Math.max(0, Math.round(e.diff(s, 'days').days)) : 0;
}

/**
 * Покрывает ли бронь отеля этот город. Привязка прежде всего по
 * `city_visit_id`; отель БЕЗ привязки судится перекрытием дат — той же
 * эвристикой, что исторически жила в ленте (её нельзя просто выбросить: до
 * TRIP-195 брони создавались без ссылки на визит).
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

/** Есть ли переезд ровно с этого узла на этот. */
export function transfersForLeg(transfers, from, to) {
  if (!from || !to) return [];
  return (transfers || []).filter(
    (tr) => tr.from_city_visit_id === from.id && tr.to_city_visit_id === to.id,
  );
}

/**
 * Стыки маршрута — пары СОСЕДНИХ узлов (якорь старта → транзитные города →
 * якорь финиша), у которых города РАЗНЫЕ. Идентичность города, а не id визита:
 * «Мадрид → Мадрид» (сплит стоянки) переездом не является и стыком не считается —
 * то же правило, что у ленты (`cityIdentity`).
 */
export function routeLegs(visits = []) {
  const ordered = sortVisits(visits);
  const legs = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1];
    const to = ordered[i];
    // ★ НЕОПОЗНАННЫЙ ГОРОД НЕ РАВЕН НЕОПОЗНАННОМУ. `cityIdentity` отдаёт пустую
    // строку, когда узел не несёт ни `geonameid`, ни английского имени, ни
    // внешнего id. Сравнение «в лоб» делало ДВА таких узла одним городом, и
    // стык между ними исчезал — а на маршруте, где не опознан НИ ОДИН узел,
    // исчезали все стыки разом: половина виджета («Переезды») просто не
    // рисовалась, без ошибки и без единого красного гарда. Совпадением
    // считается только НЕПУСТАЯ равная идентичность.
    const id = cityIdentity(from);
    if (id && id === cityIdentity(to)) continue;
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
 *   done: number, total: number, pct: number,
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
  // Доля — от 0 до 1. Пустой маршрут не «готов на 100%»: бронировать нечего,
  // и виджет в этом случае показывает пустое состояние, а не полную полосу.
  return { stays, legs, done, total, pct: total ? done / total : 0 };
}
