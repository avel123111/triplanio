// @ts-check
/**
 * МОДЕЛЬ МАРШРУТА ВИЗАРДА — ОДИН СПИСОК УЗЛОВ, КАК В РЕДАКТОРЕ (TRIP-484 §4).
 *
 * ★ ЧТО ЗДЕСЬ ИСПРАВЛЕНО. Визард держал маршрут ТРЕМЯ переменными: `home`
 * (старт), `cities` (список) и `end` (`null | город | 'stay'`). Редактор
 * маршрута держит ОДИН массив узлов, у каждого свой `kind`. Это не разница во
 * вкусах: из трёх переменных нельзя выразить то, что список выражает даром —
 * старт и финиш как РЯДЫ того же списка, общий DnD с пиннингом концов, вставку
 * «перед финишем». Поэтому визард переезжает на модель редактора, а не наоборот.
 *
 * ★★ ПРАВИЛА ВСТАВКИ ВЗЯТЫ У РЕДАКТОРА ДОСЛОВНО (`EditLens.addCity`):
 *   start → в начало · end → в конец · всё остальное → ПЕРЕД финишем.
 * Отсюда «финиш всегда последний» — не проверка, а свойство построения: обойти
 * его нечем, потому что каждый следующий город вставляется перед ним.
 *
 * ⚠️ `nights` РЕШАЕТ ЦЕПОЧКУ ДАТ, А НЕ `kind` — и это НЕ второй источник правды.
 * В цепочку входит узел, у которого ночи ЕСТЬ (`nights != null`); у якорей их
 * нет. Так было и до переезда (`home`/`end` в `cities` не лежали), поэтому даты
 * на тех же данных получаются побайтово те же. Связь «ночи ↔ вид» держит
 * `withNights` — ЕДИНСТВЕННОЕ место, где `transit` превращается в `waypoint` и
 * обратно, чтобы плитка вида и степпер ночей не могли разойтись.
 *
 * ★★★ ФИНИШ — ОДИН ОБЪЕКТ, И ЭТО ЯКОРЬ БЕЗ НОЧЕЙ. Ровно одна форма на все
 * сценарии: узел `kind:'end'`, `nights: null`, ряд-якорь. «Домой» — тот же узел
 * с городом старта; «в другой город» — тот же узел с выбранным городом.
 *
 * ⚠️ «ОСТАНУСЬ В X» — ЭТО ОТСУТСТВИЕ ФИНИША, А НЕ ЕГО ВТОРОЙ ВИД. Смысл выбора:
 * «в конце я никуда не еду, маршрут кончается там, где кончается». Прежняя
 * редакция помечала последний город `kind:'end'`, СОХРАНЯЯ ему ночи, — и этим
 * заводила второй вид финиша: у одного ночей нет и он якорь, у другого три ночи
 * и он ряд города. Один экран рисовал одно, другой другое; словом «финиш»
 * назывались два разных объекта. Поэтому «останусь» узла НЕ создаёт и НЕ
 * помечает: список просто не содержит `end`.
 *
 * ⚠️ СЛЕДСТВИЕ: НЕТ УЗЛА `end` ⇒ МАРШРУТ КОНЧАЕТСЯ ПОСЛЕДНИМ ГОРОДОМ. Прежде
 * `toCitiesPayload` дописывал клон старта, когда финиша нет, — то есть «не
 * выбрал» молча значило «домой», и «останусь» приходилось чем-то помечать,
 * иначе оно было неотличимо. Дефолт снят: возврат домой существует только как
 * ЯВНО выбранный узел. Решение Pavel 31.08.2026.
 */
// Импорт ОТНОСИТЕЛЬНЫЙ, а не через `@/`, и это условие проверяемости: тесты
// репозитория гоняет голый `node --test`, который алиас `@/` не разрешает (в
// тестовых файлах он встречается только строками внутри грепов). Модель маршрута
// обязана быть загружаемой из теста — иначе у неё, как у прежних трёх
// переменных, не будет ни одного свидетеля, кроме глаз.
import { layoutDates } from '../../lib/tripDates.js';

/** @typedef {'start'|'transit'|'waypoint'|'end'} NodeKind */
/**
 * @typedef {{ id: any, kind: NodeKind, city_name?: string, city_name_en?: string,
 *   country?: string, country_code?: string, geonameid?: any, name_i18n?: any,
 *   external_city_id?: any, latitude?: any, longitude?: any, timezone?: any,
 *   nights?: number|null, startDate?: string }} RouteNode
 */

/** Якорь маршрута — узел без ночей, пиннится к своему концу списка. */
export const isAnchorNode = (n) => n?.kind === 'start' || n?.kind === 'end';

/** Старт маршрута (узел `start`), либо `null`. */
export const startOf = (nodes) => (nodes || []).find((n) => n.kind === 'start') || null;

/** Финиш маршрута — ПЕРВЫЙ узел `end`. Их не бывает двух: вставка это гейтит. */
export const endOf = (nodes) => (nodes || []).find((n) => n.kind === 'end') || null;

/** Города списка: всё, что не старт. Финиш-«останусь» сюда входит — он и есть город. */
export const stopsOf = (nodes) => (nodes || []).filter((n) => n.kind !== 'start');

/**
 * Финиш ВЫБРАН явно. Единственный предикат, по которому шаг возврата
 * пропускается: он одинаково верен и для «финиш — другой город», и для
 * «останусь» (последний город помечен финишем).
 */


/**
 * «ОСТАНУСЬ» — ФИНИШ, КОТОРЫЙ И ЕСТЬ ГОРОД СПИСКА. Отличается от финиша-отдельного
 * города ровно тем, что в нём ночуют: у города ночи есть, у терминала их нет.
 * Предикат нужен вне модели (карта не рисует отдельный пин финиша, если финиш —
 * это последний город; ревью не показывает его отдельной строкой).
 *
 * ⚠️ Это форма ВИЗАРДА, а не редактора: у редактора «останусь» выражено
 * ОТСУТСТВИЕМ узла `end`. Визард сохраняет последний город как `kind:'end'` — так
 * он делал и до переезда, и трогать это здесь значило бы менять сохранённые
 * данные под видом рефакторинга.

/** Города списка для карты и ревью: всё, кроме якорей. */
export const cityNodesOf = (nodes) => (nodes || []).filter((n) => !isAnchorNode(n));

/** Финиш ВЫБРАН — то есть в списке есть узел `end`. Формы у него одна, поэтому
 *  и вывода никакого: «где финиш» = `endOf(nodes)`. Второго ответа не бывает. */
export const hasExplicitEnd = (nodes) => !!endOf(nodes);

/** Узлы, у которых есть ночи — ровно они и составляют цепочку дат. */
const chainOf = (nodes) => (nodes || []).filter((n) => n.nights != null);

/**
 * ★ ЕДИНСТВЕННОЕ МЕСТО, ГДЕ НОЧИ И ВИД СВЯЗАНЫ. Пересадка — это «ноль ночей», и
 * до переезда визард выводил вид из ночей, а редактор хранил его явно. Держать
 * оба и не связать = два источника одного факта: плитка «пересадка» в шторке и
 * степпер в ряду разошлись бы на первом же нажатии.
 * Якорей не касается: у старта и финиша ночей нет вовсе, и степпера у них нет.
 * @param {RouteNode} node
 * @param {number} nights
 */
export function withNights(node, nights) {
  if (isAnchorNode(node)) return node;
  const n = Math.max(0, +nights || 0);
  return { ...node, nights: n, kind: n === 0 ? 'waypoint' : 'transit' };
}


/**
 * ФАБРИКА УЗЛА — ОДНА НА ВСЕ ВХОДЫ. Город приезжает из четырёх мест (композер,
 * поле старта шага 1, поле «другой город» шага 3, черновик ИИ), и форма узла у
 * них обязана быть одна: иначе поля разъедутся ровно так, как разъехались две
 * копии `CityPicker`. Ночи выдаёт ВИД: у якоря их нет, у пересадки ноль.
 * @param {any} city
 * @param {NodeKind} kind
 * @param {{ id?: any, nights?: number }} [opts]
 */
export function makeNode(city, kind, opts = {}) {
  const nights = isAnchorNode({ kind })
    ? null
    : (kind === 'waypoint' ? 0 : Math.max(1, +(opts.nights ?? 3) || 3));
  return {
    id: opts.id ?? (Date.now() + Math.floor(Math.random() * 1000)),
    kind,
    city_name: city?.city_name || '',
    city_name_en: city?.city_name_en || '',
    country: city?.country || '',
    country_code: city?.country_code || '',
    geonameid: city?.geonameid ?? null,
    name_i18n: city?.name_i18n || null,
    external_city_id: city?.external_city_id || null,
    latitude: city?.latitude ?? null,
    longitude: city?.longitude ?? null,
    timezone: city?.timezone || null,
    nights,
  };
}


/**
 * Вставка узла по правилам редактора. Возвращает `null`, если вид занят
 * (второй старт / второй финиш) — вызыватель показывает тот же отказ, что и
 * редактор, а модель молча вторым якорем не обзаводится.
 * @param {RouteNode[]} nodes
 * @param {RouteNode} node
 */
export function insertNode(nodes, node) {
  const arr = (nodes || []).slice();
  if (isAnchorNode(node) && arr.some((n) => n.kind === node.kind)) return null;
  if (node.kind === 'start') { arr.unshift(node); return arr; }
  if (node.kind === 'end') { arr.push(node); return arr; }
  const endIdx = arr.findIndex((n) => n.kind === 'end');
  arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node);
  return arr;
}

/**
 * Разложить даты по цепочке. Движок дат общий с редактором и сервером
 * (`lib/tripDates.layoutDates`) — второй реализации дат в проекте нет.
 * Якорь цепочки — СТАБИЛЬНАЯ дата старта трипа, а не дата первого элемента:
 * иначе перетаскивание города наверх пере-якорит весь маршрут (TRIP-216).
 * @param {RouteNode[]} nodes
 * @param {string} anchorISO
 */
export function recomputeDates(nodes, anchorISO) {
  const chain = chainOf(nodes);
  const base = anchorISO || chain[0]?.startDate;
  if (chain.length === 0 || !base) return nodes;
  const laid = layoutDates(chain.map((n) => ({ kind: 'transit', nights: +n.nights || 0, gap: 0 })), base);
  let i = 0;
  return (nodes || []).map((n) => (n.nights != null ? { ...n, startDate: laid[i++].start_date } : n));
}

/** Поля города, которые едут на сервер. Порядок и состав — как были. */
const cityIdentity = (c) => ({
  external_city_id: c.external_city_id || null,
  geonameid: c.geonameid ?? null,
  name_i18n: c.name_i18n || null,
  city_name_en: c.city_name_en || null,
  country_code: c.country_code || null,
  latitude: c.latitude || null,
  longitude: c.longitude || null,
  timezone: c.timezone || null,
});

/**
 * Полезная нагрузка создания трипа. Проекция ПОИМЁННАЯ: лишние поля модели
 * (`id`, `startDate`, `prevNights`) наружу не текут.
 *
 * ⚠️ ЯКОРЬ ЕДЕТ БЕЗ НОЧЕЙ, ДАЖЕ ЕСЛИ ОНИ У НЕГО ЕСТЬ. Так было и раньше: город,
 * помеченный «останусь», сохранялся как `kind:'end'` без ночей, при том что в
 * списке ночи у него оставались. Поведение сохранено дословно.
 *
 * ⚠️ ФИНИШ ПО УМОЛЧАНИЮ ДОПИСЫВАЕТСЯ ЗДЕСЬ. Финиш не выбран, а старт есть →
 * «домой»: клон старта отдельным узлом `end`. Это ровно прежний вывод
 * `finishCity = end || home`, просто теперь он живёт в одном месте, а не
 * размазан по карте, ревью и сохранению.
 * @param {RouteNode[]} nodes
 */
export function toCitiesPayload(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (!n.city_name) continue;
    if (isAnchorNode(n)) out.push({ ...cityIdentity(n), kind: n.kind });
    else if (n.kind === 'waypoint') out.push({ ...cityIdentity(n), kind: 'waypoint' });
    else out.push({ ...cityIdentity(n), kind: 'transit', nights: +n.nights || 0 });
  }
  // Клона старта здесь БОЛЬШЕ НЕТ: возврат домой существует только как явно
  // выбранный узел `end` (его создаёт карточка «домой» на шаге возврата). Нет
  // узла — маршрут кончается последним городом, и это тот же факт, который
  // видят все экраны.
  return out;
}
