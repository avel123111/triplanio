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
 * ★ ДЛИТЕЛЬНОСТЬ ЗДЕСЬ ОДНА НА ВСЕХ (`slotMin`) — ровно та, которой тайм-грид
 * рисует блок. Модель шире, чем сетка, не бывает: если блок высотой в час, то и
 * пересечением считается час, иначе на экране разъедутся ширина и высота.
 */

/**
 * @param {number[]} starts начала событий в минутах от полуночи (порядок любой)
 * @param {number} [slotMin] длительность блока в минутах (высота блока сетки)
 * @returns {{ lane: number, lanes: number }[]} дорожка и число дорожек её
 *   кластера — В ПОРЯДКЕ ВХОДА, чтобы результат ложился на исходный массив
 */
export function eventLanes(starts, slotMin = 60) {
  const order = starts
    .map((startMin, i) => ({ startMin, i }))
    .sort((a, b) => a.startMin - b.startMin || a.i - b.i);

  /** @type {{ lane: number, lanes: number }[]} */
  const out = new Array(starts.length);
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
    if (it.startMin >= clusterEnd) flush();
    const end = it.startMin + slotMin;
    let lane = laneEnds.findIndex((e) => e <= it.startMin);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    cluster.push({ i: it.i, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return out;
}
