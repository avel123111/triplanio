import { useEffect, useRef, useState } from 'react';

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
export function usePresence(open, ms = 240) {
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

/**
 * Один «выходящий» слой для стопки панелей. Когда ВЕРХНЯЯ панель сменилась
 * (`key` стал другим), возвращает замороженный СНИМОК предыдущей — `{ key, el }` —
 * на `ms`, чтобы его отрисовать поверх/под новым с `data-closing` и проиграть
 * уход. Так push/replace/pop идут КРОССФЕЙДОМ (новая въезжает, старая уезжает),
 * а не рывком, при этом в памяти держится максимум ДВА слоя, а не вся стопка.
 *
 * `key` — устойчивый ключ верхней панели (null = панелей нет). `elRef` — РЕФ на
 * её текущий React-узел (реф, а не значение: хук обязан стоять ДО ранних
 * возвратов компонента, а сам узел строится позже — реф отдаёт его снимок в
 * момент смены). Возврат — слой для выхода или null.
 *
 * @param {string|null} key
 * @param {{current:any}} elRef
 * @param {number} [ms]
 * @returns {{ key: string, el: any } | null}
 */
export function useExitingLayer(key, elRef, ms = 240) {
  const [exiting, setExiting] = useState(/** @type {{key:string, el:any}|null} */ (null));
  const cur = useRef({ key, el: /** @type {any} */ (null) });
  const timer = useRef(/** @type {any} */ (null));

  // ⚠️ ПУСТОГО МАССИВА ЗАВИСИМОСТЕЙ ТУТ НЕТ НАМЕРЕННО — эффект обязан бежать
  // КАЖДЫЙ рендер, чтобы ветка «тот же ключ» освежала снимок узла ДО смены ключа.
  // Сведёшь к `[key]` — снимок перестанет обновляться, и на смене ключа
  // `elRef.current` будет уже ВХОДЯЩИМ узлом → уйдёт в заморозку не та панель.
  useEffect(() => {
    // Тот же ключ — просто обновляем снимок узла (живые данные верхней панели).
    if (cur.current.key === key) { cur.current.el = elRef.current; return; }
    // Ключ сменился — предыдущая (если была реальной) уходит замороженным снимком.
    if (cur.current.key != null) {
      setExiting({ key: cur.current.key, el: cur.current.el });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setExiting(null), ms);
    }
    cur.current = { key, el: elRef.current };
  });

  useEffect(() => () => clearTimeout(timer.current), []);
  return exiting;
}

export default usePresence;
