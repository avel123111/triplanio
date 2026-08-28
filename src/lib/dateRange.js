// @ts-check
/**
 * Связка границ события во времени (TRIP-484 §4) — ЧИСТЫЙ слой, без React и без
 * знания о форме.
 *
 * ЗАЧЕМ. У формы события шесть пар дат (отель заезд/выезд, активность и переезд
 * начало/конец, аренда авто получение/возврат, страховка, и цепочка сегментов
 * переезда с пересадками). Связи между концами не было НИ У ОДНОЙ: сдвинул
 * начало вперёд — конец остался позади него, добавил сегмент — его даты пустые,
 * и конец предыдущего звена ничего не подсказывал следующему. Правило при этом
 * одно на все шесть, поэтому и живёт оно здесь одной функцией, а не шестью
 * копиями по веткам формы; вид (`DateRangeBlock`) остаётся презентационным.
 *
 * ЗАКОН. Границы монотонны: следующая не раньше предыдущей. Правка ТЯНЕТ ВПЕРЁД
 * и никогда не тянет назад — назад пользователь двигает сам, а «конец раньше
 * начала» и так ловит валидатор (`TR_ORDER`/`SEG_ORDER`/`HOTEL_ORDER`), и молча
 * переставлять ему введённое было бы хуже ошибки.
 *
 * ★ ЧТО НЕ ВЫДУМЫВАЕМ. Пустой конец пары остаётся пустым: длительность отеля или
 * перелёта из воздуха не берётся. А вот пустое начало СЛЕДУЮЩЕГО звена цепочки —
 * это не догадка, а тот же момент времени, что конец предыдущего (прилетел в
 * город пересадки — оттуда и вылетаешь), поэтому оно наследуется.
 *
 * ★★ АРИФМЕТИКА НАМЕРЕННО НАИВНАЯ («настенная»). Границы — локальные строки без
 * зоны, и у переезда концы бывают в РАЗНЫХ зонах. Сохраняя разницу настенных
 * часов, вылет 12:00 Лиссабон → прилёт 15:00 Париж при переносе на другой день
 * остаётся «12:00 → 15:00», чего пользователь и ждёт. Luxon здесь не нужен:
 * зоны в этих строках нет по определению.
 */

/** Локальная строка: 'yyyy-MM-dd' (без времени) либо 'yyyy-MM-ddTHH:mm'. */
const hasTime = (v) => typeof v === 'string' && v.length > 10;

/** Локальная строка → мс (как UTC: зоны в строке нет, разница считается настенная). */
const toMs = (v) => {
  if (typeof v !== 'string' || v.length < 10) return null;
  const ms = Date.parse(hasTime(v) ? `${v.slice(0, 16)}:00Z` : `${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

/** мс → локальная строка ТОЙ ЖЕ формы, что образец (с временем или без). */
const fromMs = (ms, sample) => {
  const iso = new Date(ms).toISOString();
  return hasTime(sample) ? iso.slice(0, 16) : iso.slice(0, 10);
};

/**
 * Конец пары после правки НАЧАЛА.
 *
 * Пока конец позже нового начала — не трогаем вовсе. Если начало его обогнало —
 * конец уезжает вперёд, СОХРАНЯЯ прежнюю длительность (двухчасовой перелёт
 * остаётся двухчасовым, четыре ночи — четырьмя). Длительность неизвестна (не
 * было прежнего начала или пара уже была вывернута) — конец встаёт на начало.
 *
 * @param {string} prevStart прежнее начало ('' — не было)
 * @param {string} nextStart новое начало
 * @param {string} end текущий конец ('' — не задан)
 * @returns {string} конец после связки (та же строка, если двигать нечего)
 */
export function endAfterStart(prevStart, nextStart, end) {
  const endMs = toMs(end);
  const nextMs = toMs(nextStart);
  if (endMs == null || nextMs == null) return end;   // пустое не выдумываем
  if (endMs >= nextMs) return end;                   // конец и так позже — не трогаем
  const prevMs = toMs(prevStart);
  const span = prevMs != null && endMs > prevMs ? endMs - prevMs : 0;
  return fromMs(nextMs + span, end);
}

/**
 * Сдвинуть ЗВЕНО ЦЕЛИКОМ на новое начало, сохранив его длительность.
 *
 * Разница с {@link endAfterStart} принципиальная и потому названа отдельно: там
 * начало двигает САМ пользователь и видит поле, поэтому конец не трогается, пока
 * он позже начала. Здесь начало двигаем МЫ (разлив по цепочке), и оставить конец
 * на месте значило бы молча переписать длительность перелёта, которую пользователь
 * ввёл: сосед задержался — звено едет за ним целиком, а не сжимается.
 */
function shiftLink(link, start) {
  const fromM = toMs(link.start);
  const endM = toMs(link.end);
  const startM = toMs(start);
  if (fromM != null && endM != null && startM != null && endM > fromM) {
    return { ...link, start, end: fromMs(startM + (endM - fromM), link.end) };
  }
  return { ...link, start, end: endAfterStart(link.start, start, link.end) };
}

/**
 * Цепочка звеньев `[{ start, end }, …]` (сегменты переезда с пересадками) после
 * правки одной границы. Правка звена `i` разливается ВПЕРЁД: конец звена задаёт
 * начало следующего (пустое — наследует, более раннее — уезжает на него), а
 * сдвинутое начало тянет свой конец тем же {@link endAfterStart}. Как только
 * очередное звено уже лежит позже предыдущего, разлив останавливается —
 * дальше по цепочке ничего не меняется.
 *
 * @param {{start: string, end: string}[]} links
 * @param {number} i индекс правленого звена
 * @param {{start?: string, end?: string}} patch
 * @returns {{start: string, end: string}[]} новая цепочка (вход не мутируется)
 */
export function relinkChain(links, i, patch) {
  if (!Array.isArray(links) || !links[i]) return links;
  const next = links.map((l) => ({ ...l }));
  const link = next[i];
  if (patch.start !== undefined) {
    link.end = endAfterStart(link.start, patch.start, link.end);
    link.start = patch.start;
  }
  if (patch.end !== undefined) link.end = patch.end;

  for (let j = i; j < next.length - 1; j += 1) {
    const prevEnd = next[j].end;
    const prevEndMs = toMs(prevEnd);
    if (prevEndMs == null) break;                 // нечего разливать дальше
    const cur = next[j + 1];
    const curMs = toMs(cur.start);
    if (curMs != null && curMs >= prevEndMs) break; // цепочка уже монотонна
    const start = fromMs(prevEndMs, cur.start || prevEnd); // форма берётся у соседа: дата без времени остаётся датой
    next[j + 1] = shiftLink(cur, start);
  }
  return next;
}
