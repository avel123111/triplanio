// @ts-check

/**
 * Детенты боттом-шита — ЧИСТАЯ арифметика (TRIP-422).
 *
 * ★ ЗАЧЕМ ОТДЕЛЬНО. Это правила, у которых нет скриншота: «на какой высоте
 * встанет шит» и «куда он поедет, когда палец отпустили». Ошибка в них
 * выглядит как шит, севший не туда, или как заголовок, обрезанный доком, —
 * ловится глазом и поздно. Чистые функции без импортов бегут в `node --test`;
 * компоненту остаётся жест и DOM.
 */

/** Минимум канваса под шитом: он не имеет права занять экран целиком «в ноль». */
const MIN_TOP_GAP = 0;

/**
 * Доли высоты экрана → пиксельные высоты детентов.
 *
 * Нижний детент поднимается до `headPx` (грип + шапка + док + safe-area): доля
 * меньше собственной шапки означала бы обрезанный заголовок, а не «маленький
 * шит». Значения сортируются и дедуплицируются — два совпавших детента дали бы
 * жест, который «залипает» между ними.
 *
 * @param {number[]} fractions доли 0..1
 * @param {number} vh высота вьюпорта, px
 * @param {number} headPx измеренная полоса шапки, px
 * @returns {number[]} высоты по возрастанию, px
 */
export function resolveDetents(fractions, vh, headPx = 0) {
  if (!(vh > 0)) return [];
  const min = Math.min(Math.max(0, headPx), vh);
  const max = Math.max(0, vh - MIN_TOP_GAP);
  const px = (Array.isArray(fractions) && fractions.length ? fractions : [1])
    .filter((f) => typeof f === 'number' && Number.isFinite(f))
    .map((f) => Math.round(Math.min(Math.max(f, 0), 1) * vh))
    .map((h) => Math.min(max, Math.max(min, h)));
  const uniq = [...new Set(px)].sort((a, b) => a - b);
  return uniq.length ? uniq : [min];
}

/**
 * Куда сесть после отпускания.
 *
 * Бросок (`flick` ±1) коммитит В СВОЮ СТОРОНУ на один детент, какой бы короткой
 * ни была дистанция — иначе быстрый короткий свайп «не сработал бы». Медленная
 * или замершая тяга садится на БЛИЖАЙШИЙ детент по фактической высоте.
 *
 * @param {{ stops: number[], height: number, from: number, flick?: number }} p
 * @returns {number} индекс детента
 */
export function nearestDetent({ stops, height, from, flick = 0 }) {
  if (!Array.isArray(stops) || stops.length === 0) return 0;
  const last = stops.length - 1;
  const cur = Math.max(0, Math.min(last, from | 0));
  if (flick > 0) return Math.min(last, cur + 1);
  if (flick < 0) return Math.max(0, cur - 1);
  let best = 0;
  let bestD = Infinity;
  stops.forEach((h, i) => {
    const d = Math.abs(h - height);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * КОМУ ПРИНАДЛЕЖИТ ЖЕСТ: шиту или скроллу тела.
 *
 * ★ ПОЧЕМУ ЭТО ПРАВИЛО, А НЕ УСЛОВИЕ В ОБРАБОТЧИКЕ. Прошлая редакция отдавала
 * жест ШИТУ на любом детенте кроме верхнего («не на максимуме — значит тянут
 * шит»). Следствие: на среднем детенте список не скроллился ВООБЩЕ, хотя
 * содержимое в него не влезало. Дефект поведенческий, скриншота у него нет, и
 * ловится он только тем, что правило вынуто и закрыто тестом.
 *
 * Правило (оно же — привычка любого системного шита):
 *   · перетаскивание УЖЕ идёт в содержимом → жест не наш вовсе;
 *   · палец на грипе или шапке    → всегда шит (это его ручка);
 *   · телу нечего скроллить       → шит (иначе жест умирает впустую);
 *   · тянут ВНИЗ, тело в самом верху → шит (это «опустить», а не «прокрутить»);
 *   · иначе                        → скролл тела.
 *
 * ★ `dragElsewhere` — В СОДЕРЖИМОМ УЖЕ ТАЩАТ. Список маршрута переставляется
 * долгим нажатием: палец держит карточку города и ведёт её вверх-вниз. Для шита
 * это неотличимо от свайпа, и он уезжал вместе с городом — переставить город на
 * телефоне было нельзя вовсе. Кто тащит, шит не знает и знать не должен: факт
 * «перетаскивание идёт» объявлен на корне документа (`data-dragging`), тем же
 * приёмом, каким объявлена открытая клавиатура (`data-keyboard`).
 *
 * @param {{ onHandle?: boolean, dragElsewhere?: boolean, dy?: number, scrollTop?: number, scrollHeight?: number, clientHeight?: number }} [p]
 *   `dy` — смещение пальца, + вниз; остальное — состояние скроллера тела.
 * @returns {'drag' | 'scroll' | 'none'}
 */
export function gestureOwner({ onHandle = false, dragElsewhere = false, dy = 0, scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  if (dragElsewhere) return 'none';
  if (onHandle) return 'drag';
  // +1 — щит от дробных размеров: у неприкрученного скроллера scrollHeight
  // бывает на доли пикселя больше clientHeight, и это не «есть что скроллить».
  const scrollable = scrollHeight > clientHeight + 1;
  if (!scrollable) return 'drag';
  // Условие разбито на две строки не для красоты: знаки «больше» и «меньше» на
  // ОДНОЙ строке сканер i18n читает как JSX-текст (та же ловушка описана у
  // разбора броска в `PeekSheet`).
  if (dy <= 0) return 'scroll';
  if (scrollTop <= 0) return 'drag';
  return 'scroll';
}
