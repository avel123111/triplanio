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
 * ⚠️ «ОСТАНУСЬ» УЗЛА НЕ СОЗДАЁТ: это последний город, помеченный `kind:'end'`.
 * Поэтому и «выбрал финиш отдельным городом», и «останусь» — один и тот же факт
 * `hasExplicitEnd(nodes)`, и шаг возврата пропускается по нему одному.
 *
 * ⚠️ ФИНИШ «ДОМОЙ» УЗЛОМ НЕ ЛЕЖИТ, И ЭТО НАМЕРЕННО. Пока человек не выбрал
 * финиш, узла нет — иначе шаг возврата пропускался бы у того, кто до него ещё не
 * дошёл. Клон старта дописывается ТОЛЬКО в полезную нагрузку сохранения
 * (`toCitiesPayload`), ровно как раньше это делал вывод `end || home`.
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
export const hasExplicitEnd = (nodes) => (nodes || []).some((n) => n.kind === 'end');

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
 */
export const isStayNode = (n) => n?.kind === 'end' && n?.nights != null;

/**
 * Города списка для карты и ревью: всё, кроме якорей — плюс «останусь», потому
 * что он город. Финиш-отдельный город сюда не входит: его рисуют финишем.
 */
export const cityNodesOf = (nodes) => (nodes || []).filter((n) => !isAnchorNode(n) || isStayNode(n));

/** Узлы, у которых есть ночи — ровно они и составляют цепочку дат. */
const chainOf = (nodes) => (nodes || []).filter((n) => n.nights != null);

/**
 * ★ ЕДИНСТВЕННОЕ МЕСТО, ГДЕ НОЧИ И ВИД СВЯЗАНЫ. Пересадка — это «ноль ночей», и
 * до переезда визард выводил вид из ночей, а редактор хранил его явно. Держать
 * оба и не связать = два источника одного факта: плитка «пересадка» в шторке и
 * степпер в ряду разошлись бы на первом же нажатии. Связь объявлена в обе
 * стороны: степпер зовёт `withNights`, плитка зовёт `withKind`.
 * Якорей не касается: у них ночей нет вовсе.
 * @param {RouteNode} node
 * @param {number} nights
 */
export function withNights(node, nights) {
  const n = Math.max(0, +nights || 0);
  // Город, помеченный финишем («останусь»), ОСТАЁТСЯ городом со своими ночами —
  // вид у него сменился, а ночевать в нём не перестали. Вид ему ночи не меняют.
  if (isAnchorNode(node)) return { ...node, nights: n };
  return { ...node, nights: n, kind: n === 0 ? 'waypoint' : 'transit' };
}

/**
 * Смена вида узла. Обратная половина той же связи: `waypoint` обязан быть
 * нулём ночей, `transit` — хотя бы одной, у якоря ночей нет.
 * @param {RouteNode} node
 * @param {NodeKind} kind
 * @param {number} [transitNights] ночи, которыми оживить `transit` (по умолчанию 1)
 */
export function withKind(node, kind, transitNights = 1) {
  if (kind === 'waypoint') return { ...node, kind, nights: 0 };
  if (kind === 'transit') return { ...node, kind, nights: Math.max(1, +node.nights || +transitNights || 1) };
  // ⚠️ ЯКОРЬ НОЧИ НЕ ТЕРЯЕТ, И ЭТО ГЛАВНОЕ В ЭТОЙ СТРОКЕ. Пометить последний
  // город финишем («останусь») — это сменить ЕМУ ВИД, а не выселить: ночи у него
  // остаются, значит он остаётся в цепочке дат и маршрут не укорачивается. Так
  // было и до переезда (`isStay` был флагом СОХРАНЕНИЯ и списка не трогал), и
  // обнуление здесь сдвинуло бы человеку даты на ровном месте. Ночей нет только
  // у финиша-ОТДЕЛЬНОГО города — их ему не даёт фабрика узла.
  return { ...node, kind };
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
 * СНЯТЬ С УЗЛА РОЛЬ ФИНИША, вернув ему вид ПО НОЧАМ. Нужна ровно там, где
 * «останусь» переключают на другой вариант возврата.
 *
 * ⚠️ Прямое `withKind(n, 'transit')` тут НЕВЕРНО, и ошибка тихая: у пересадки,
 * помеченной финишем, ночей ноль, а `transit` по определению начинается с одной
 * — значит переключение туда-обратно молча превращало бы пересадку в ночёвку.
 * Вид считает `withNights` — та же единственная связь «ночи ↔ вид», что у
 * степпера и плитки.
 * @param {RouteNode} node
 */
export const asCity = (node) => withNights({ ...node, kind: 'transit' }, node.nights ?? 1);

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
  const start = startOf(nodes);
  if (!hasExplicitEnd(nodes) && start?.city_name) out.push({ ...cityIdentity(start), kind: 'end' });
  return out;
}
