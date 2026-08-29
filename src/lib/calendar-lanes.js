// @ts-check
/**
 * Дорожки пересекающихся событий дня в тайм-гриде недели.
 *
 * ★ ШИРИНУ РЕШАЕТ КЛАСТЕР, А НЕ ДЕНЬ. Прежняя редакция считала число дорожек
 * ОДИН РАЗ на весь день (`max(lane)+1`) и раздавала его всем событиям дня: два
 * события на 14:00 и 14:10 делили колонку пополам — и вместе с ними в половину
 * колонки уезжали утренний перелёт и дневной выезд из отеля, которые ни с чем
 * не пересекаются. Ширина обязана считаться по КЛАСТЕРУ — связной группе
 * событий, где каждое следующее начинается раньше, чем кончилось самое позднее
 * из накопленных: за пределами кластера дорожек нет, и событие занимает колонку
 * целиком.
 *
 * ★ ПЕРЕСЕЧЕНИЕ СЧИТАЕТСЯ ПО ТОМУ ЖЕ ОТРЕЗКУ, КОТОРЫЙ НАРИСОВАН. На вход идут
 * готовые отрезки дня (`lib/calendar-spans.js`), а не «начало + слот в час»:
 * пока длительность выдумывалась, событие 10:00–10:30 «занимало» до 11:00 и
 * ложно жалось с соседом в 10:45, а активность 10:00–14:00 не замечала перелёта
 * в 12:00. Ширина и высота обязаны расходиться из одного источника.
 */

/**
 * @param {{ from: number, to: number }[]} spans отрезки дня в минутах от
 *   полуночи (порядок любой; конец — тот же, каким блок нарисован)
 * @returns {{ lane: number, lanes: number }[]} дорожка и число дорожек её
 *   кластера — В ПОРЯДКЕ ВХОДА, чтобы результат ложился на исходный массив
 */
export function eventLanes(spans) {
  const order = spans
    .map((s, i) => ({ from: s.from, to: s.to, i }))
    .sort((a, b) => a.from - b.from || a.to - b.to || a.i - b.i);

  /** @type {{ lane: number, lanes: number }[]} */
  const out = new Array(spans.length);
  /** @type {{ i: number, lane: number }[]} */
  let cluster = [];
  /** @type {number[]} */
  let laneEnds = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const it of cluster) out[it.i] = { lane: it.lane, lanes };
    cluster = []; laneEnds = []; clusterEnd = -Infinity;
  };

  for (const it of order) {
    // Кластер кончился: событие начинается не раньше, чем кончилось последнее
    // из накопленных. Все дорожки свободны — счёт начинается заново.
    if (it.from >= clusterEnd) flush();
    const end = it.to > it.from ? it.to : it.from + 1;
    let lane = laneEnds.findIndex((e) => e <= it.from);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    cluster.push({ i: it.i, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return out;
}
