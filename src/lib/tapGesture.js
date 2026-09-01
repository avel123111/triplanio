// @ts-check
/**
 * Был ли жест ТАПОМ — по паре pointerdown/pointerup.
 *
 * Выбор строки в пикере снят с синтетического `click`: на iOS слово из подсказки
 * клавиатуры остаётся незакоммиченной композицией, первое касание вне поля
 * тратится на её коммит, и `click` до строки не доходит (лечили TRIP-484).
 * Отдельным модулем — чтобы правило можно было проверить тестом: `node --test`
 * JSX не грузит.
 *
 * Порог — тот же, что у «нажал / повёз» в `useRouteDnD`.
 */
export const TAP_SLOP = 9;

/**
 * @param {{ id: number, x: number, y: number, row: any }|null|undefined} down
 * @param {{ id: number, x: number, y: number }|null|undefined} up
 * @param {number} [slop]
 * @returns {any|null} строка из `down` (по чему нажали) или null, если не тап
 */
export function tapPick(down, up, slop = TAP_SLOP) {
  if (!down || !up) return null;
  if (down.id !== up.id) return null;                                  // чужой палец
  if (Math.hypot(up.x - down.x, up.y - down.y) > slop) return null;    // это скролл
  return down.row ?? null;
}

/**
 * ПРОГЛОТИТЬ СИНТЕТИЧЕСКИЙ `click`, который придёт следом за тапом.
 *
 * ★ ЗАЧЕМ. Выбор строки снят с `click` и сделан жестом (`tapPick` выше), но
 * браузер об этом не знает: после касания он всё равно шлёт совместимостный
 * `click`, и шлёт его ПОЗЖЕ — по координатам, то есть по разметке, которая к
 * тому моменту уже сменилась. Выбор города перерисовывает коробку композера, и
 * на месте строки оказывается ряд «тип точки»: тап по городу молча нажимал ту
 * плитку, что легла под палец.
 *
 * ЭТО НЕ КОСМЕТИКА. Замер (Chromium, тач-эмуляция 390): тап по первой строке в
 * точке x=235 → плитка «Старт» (x 197..280) → город уходил в маршрут СТАРТОМ
 * вместо посещения. Человек не выбирал вид точки и не видел, что выбор
 * произошёл.
 *
 * ★ ТОЛЬКО ТАЧ, И ПОЭТОМУ ЭТО ПРОПУСТИЛИ. Мышиный путь такого `click` не шлёт
 * вовсе (проверено тем же прогоном: слушатель в capture не поймал ни одного
 * события), поэтому на десктопе баг не воспроизводится ни глазами, ни
 * автоматизацией, которая кликает мышью.
 *
 * Глушим ПЕРВЫЙ же `click` и сразу снимаем слушатель — окно ожидания страхует
 * случай, когда браузер его не прислал (мышь, клавиатура). Окно короткое:
 * осмысленно нажать что-то другое за это время нельзя, а держать глушилку
 * дольше значит съесть настоящее нажатие.
 *
 * Слушатель в фазе ПЕРЕХВАТА и на самом верху дерева: узел, по которому
 * придётся click, к этому моменту ещё не существует, и повесить на него нечего.
 *
 * @param {any} target куда вешать (обычно `window`) — параметром ради теста
 * @param {number} [ms] страховочное окно
 * @returns {() => void} снять досрочно
 */
export const CLICK_SWALLOW_MS = 400;

export function swallowNextClick(target, ms = CLICK_SWALLOW_MS) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  let timer = null;
  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    target.removeEventListener('click', onClick, true);
  };
  const onClick = (e) => {
    e.stopPropagation?.();
    e.preventDefault?.();
    clear();
  };
  target.addEventListener('click', onClick, true);
  timer = setTimeout(clear, ms);
  return clear;
}

export default tapPick;
