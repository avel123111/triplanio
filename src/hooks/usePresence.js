import { useEffect, useRef, useState } from 'react';

/**
 * Длительность ВЫХОДНОЙ анимации ящиков/слоёв (мс) — ОДИН источник для JS.
 * Обязана совпадать с CSS-правилами `tsDrawerOut`/`fadeOut` (`.24s` в
 * `app.css`): таймер, снимающий узел, не должен срезать анимацию или провисать
 * после неё. Держат её ДВА JS-потребителя — `usePresence` (EventDrawerHost) и
 * таймер снятия слоя стопки в EditLens (`closingLayers`); чтобы они не разошлись,
 * число здесь одно. (CSS — родной дом самой анимации; при правке менять оба.)
 */
export const DRAWER_EXIT_MS = 240;

/**
 * Держит узел смонтированным на время его ВЫХОДНОЙ анимации.
 *
 * `open` — намерение (открыт/закрыт). Возврат `present` остаётся `true` ещё
 * `ms` после того, как `open` стал `false`: за это время CSS-правило
 * `[data-closing]` проигрывает выход, после чего `present` гаснет и вызывающий
 * размонтирует узел. `closing` = «сейчас идёт выход» — вешается атрибутом
 * `data-closing`, который и переключает анимацию на обратную.
 *
 * Тот же приём, что у тостов репозитория (`data-state=enter/leave`), только без
 * стороннего рантайма: одна пара состояния + таймер. `ms` ОБЯЗАН совпадать с
 * длительностью выходного правила в CSS, иначе узел либо срежется на середине
 * анимации, либо провисит лишнее после её конца.
 *
 * @param {boolean} open
 * @param {number} [ms]
 * @returns {{ present: boolean, closing: boolean }}
 */
export function usePresence(open, ms = DRAWER_EXIT_MS) {
  const [present, setPresent] = useState(open);
  const timer = useRef(/** @type {any} */ (null));

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) { setPresent(true); return undefined; }
    if (present) timer.current = setTimeout(() => setPresent(false), ms);
    return () => clearTimeout(timer.current);
  }, [open, present, ms]);

  return { present, closing: present && !open };
}

export default usePresence;
