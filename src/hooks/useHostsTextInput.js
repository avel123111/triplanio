// @ts-check
import { useCallback, useRef } from 'react';
import { TEXT_INPUT_SELECTOR } from '@/lib/focusAnchor';

/**
 * useHostsTextInput — поверхность САМА объявляет, что несёт текстовый ввод.
 *
 * ★★ ПОЧЕМУ ЗАМЕР, А НЕ ПРОП. Первая редакция брала это пропом (`hasInput`), и
 * это была ошибка того самого класса, который репо уже дважды оплатил. Факт
 * «внутри есть поле» — свойство ОТРИСОВАННОГО ДЕРЕВА, а не решение вызывателя:
 * вызывателей у `<Sheet>` и `<Dialog>` тринадцать, поле у них приезжает
 * переменной (`body` в SearchSelect, `steps` в редакторе маршрута), и объявить
 * его правильно надо не один раз, а навсегда. Отказ при этом МОЛЧАЛИВЫЙ —
 * кто-то добавит поле в существующий шит, ревью ничего не заметит, вылезет
 * только на айфоне. Статическим гардом это не ловится по построению: сквозь
 * переменную JSX-анализ поддерева не видит.
 *
 * Конвенция репо на такой случай уже есть, и она обратная пропу: КОГДА ФАКТ —
 * СВОЙСТВО ДЕРЕВА, ЕГО МЕРЯЮТ. Прецеденты: `--nav-dock-h` («высоту дока
 * публикует сам док, и не числом, а измерением себя» — заменил три рукописные
 * константы), полоса шапки в `PeekSheet` («магических пикселей вызывателю
 * передавать не нужно»), ширина панели в `MapShell`. Здесь тот же ход, и он
 * убирает не «13 правок», а сам класс отказа: забыть больше нечего.
 *
 * ★ РЕЗУЛЬТАТ — DATA-АТРИБУТ, А НЕ КЛАСС. Тоже канон репо (`data-theme`,
 * `data-keyboard`, `data-collapsed`, `data-detent`): состояние элемента живёт
 * атрибутом, потому что новый класс состояния растил бы число классов
 * дизайн-пола (гард 2o), ничего не добавляя языку ДС.
 *
 * ★ ПИШЕМ В DOM ИЗ REF, А НЕ ЧЕРЕЗ setState, И ЭТО НЕ СРЕЗКА. Атрибут решает
 * ВЫСОТУ поверхности: приди он вторым рендером, шит открылся бы низким и тут же
 * подрос — то есть лишнее движение ровно в тот момент, ради которого вся работа
 * и делалась. Ref-колбэк отрабатывает в фазе коммита, до отрисовки.
 *
 * ★ РАСТЁТ ОДИН РАЗ И НЕ УМЕНЬШАЕТСЯ. Содержимое приезжает асинхронно
 * (`SourceViewLoader` рисует скелетон, поля появляются после загрузки), поэтому
 * одного замера на открытии мало — за поддеревом следит `MutationObserver`.
 * Обратного хода нет намеренно: поле, исчезнувшее по ходу (в композере города
 * оно сменяется выбранным городом), не должно ронять высоту под пальцами.
 *
 * Возвращает ref-колбэк для узла поверхности:
 *   const hostRef = useHostsTextInput();
 *   <Drawer.Content ref={hostRef} className="sheet">
 */
export function useHostsTextInput() {
  const obs = useRef(/** @type {MutationObserver | null} */ (null));

  return useCallback((/** @type {HTMLElement | null} */ node) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!node) return;

    const mark = () => {
      if (!node.querySelector(TEXT_INPUT_SELECTOR)) return false;
      node.setAttribute('data-hosts-input', '');
      obs.current?.disconnect();
      obs.current = null;
      return true;
    };
    if (mark()) return;
    if (typeof MutationObserver === 'undefined') return;
    obs.current = new MutationObserver(mark);
    obs.current.observe(node, { childList: true, subtree: true });
  }, []);
}

export default useHostsTextInput;
