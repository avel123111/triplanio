import React from 'react';
import { Icon } from './icons';

/**
 * Единственный способ поставить текстовое поле (TRIP-333).
 *
 * До этого `.input` писался руками, а «поле с иконкой» было собрано заново
 * пять раз - `.dl-search`, `.s22f-search`, `.ss-search`,
 * `.trips-toolbar__search` и инлайны в `Autocomplete` - с отступом иконки
 * 11/12/13/14/15px и заново объявленной рамкой в каждом.
 *
 * Живёт отдельным модулем, а не в `design/index.jsx`: барраль реэкспортит
 * `components/ui/*` (SearchSelect и другие), и импорт поля оттуда замкнул бы
 * зависимость в кольцо. Зависимость `ui/* -> design` односторонняя, и это
 * единственное место, где её стоило бы нарушить - значит не нарушаем.
 *
 * Декорации стоят в DOM ПОСЛЕ поля и реагируют на его состояние
 * сиблинг-селектором, а не `:has()`: в цели сборки Firefox 104, где `:has()`
 * нет. Тот же приём и по той же причине, что у `.checkbox`.
 *
 * `className` уезжает на ОБЁРТКУ, а не на поле: у всех вызовов внешний класс
 * несёт раскладку (`flex`, `min-width`, порядок в медиазапросе), а не вид.
 * Модификаторы самого поля - отдельные пропы (`mono`, `num`), чтобы за них не
 * приходилось воевать со строкой класса.
 *
 * ★В `className` можно класть ТОЛЬКО раскладку, которая не смещает коробку
 * (`flex`, `min/max-width`, `order`). Ни `padding`, ни `border`: декорации
 * позиционируются от обёртки, и любой её внутренний отступ уводит иконку -
 * `.ss-search` со своим `padding: 6px` ставил её на 6px вместо 12. Такой класс
 * остаётся ОТДЕЛЬНЫМ элементом снаружи.
 */
const affixClass = (icon, hasEnd, className) =>
  ['input-affix', icon && 'input-affix--ic', hasEnd && 'input-affix--end', className]
    .filter(Boolean).join(' ');

const fieldClass = (base, mono, num) =>
  [base, mono && 'mono', num && 'num'].filter(Boolean).join(' ');

export const Input = ({
  icon, iconActive, loading, mono, num, className = '', boxRef, ...rest
}) => {
  // Слот справа резервируется, как только вызов ВООБЩЕ умеет показывать
  // спиннер (даже при `loading={false}`): включать отступ вместе со спиннером
  // значит менять ширину текстового поля прямо во время набора (TRIP-277).
  const hasEnd = loading !== undefined;
  return (
    <div className={affixClass(icon, hasEnd, className)} ref={boxRef}>
      <input className={fieldClass('input', mono, num)} {...rest} />
      {icon && (
        <span
          className={`input-affix__ic${iconActive ? ' input-affix__ic--on' : ''}`}
          aria-hidden="true"
        >
          <Icon name={icon} size={16} />
        </span>
      )}
      {loading && (
        // Обёртка держит центрирующий transform, иконка - вращение: `aispin`
        // анимирует `transform`, и на одном элементе кадр затирает
        // translateY(-50%) - иконка съезжала на пол-высоты за оборот (TRIP-277).
        <span className="input-affix__end" aria-hidden="true">
          <Icon name="refresh" size={15} className="spin" />
        </span>
      )}
    </div>
  );
};

export const Textarea = ({ mono, num, className = '', ...rest }) => (
  <textarea className={fieldClass(`textarea${className ? ' ' + className : ''}`, mono, num)} {...rest} />
);
