import React from 'react';
import { Icon } from './icons';

/**
 * «Поле обязательное» - один источник (TRIP-333): `<Field required>` кладёт флаг
 * в контекст, поле забирает его само. Пропа у `Input` нет намеренно - он был бы
 * вторым способом сказать то же самое (TRIP-293). Явный атрибут в вызове
 * по-прежнему перекрывает контекст (`{...rest}` разливается ПОСЛЕ), но признак
 * для AT считается от ИТОГОВОГО значения: иначе `required={false}` внутри
 * `<Field required>` снял бы атрибут и оставил `aria-required`.
 *
 * ★Поля редактора события на этот шов НЕ переехали: там локальные шимы, а не
 * этот компонент, поэтому звёздочка видна, а `required`/`aria-required` нет.
 * ★Нативный `required` безопасен: единственные submit-формы - на экране входа,
 * и они собраны на `.auth-input`.
 */
const RequiredCtx = React.createContext(false);
export const FieldRequired = RequiredCtx.Provider;

// Атрибуты обязательности под spread - той же формы, что и `fieldState`.
const requiredAttrs = (on) => (on
  ? { required: true, 'aria-required': 'true' }
  : null);

/**
 * Поле ввода с декорациями - иконка слева, на её месте кольцо загрузки.
 * Заменило пять отдельных сборок «поля с иконкой» с отступами 11/12/13/14/15px.
 *
 * Живёт отдельным модулем, а не в барреле `design/index.jsx`: тот реэкспортит
 * `components/ui/*`, и импорт поля оттуда замкнул бы зависимость в кольцо.
 *
 * Декорации стоят в DOM ПОСЛЕ поля и реагируют сиблинг-селектором, а не
 * `:has()` (цель сборки Firefox 78) - как у `.checkbox`.
 *
 * ★`className` уезжает на ОБЁРТКУ и может нести ТОЛЬКО раскладку, не смещающую
 * коробку (`flex`, `min/max-width`, `order`). Ни `padding`, ни `border`:
 * декорации позиционируются от обёртки, и её отступ уводит иконку - `.ss-search`
 * со своим `padding: 6px` ставил её на 6px вместо 12.
 */
/**
 * Лидирующая декорация — ЛИБО имя иконки (`icon`), ЛИБО готовая нода (`iconNode`,
 * побеждает): нода нужна там, где слева стоит не глиф системы, а маленький ассет —
 * флаг страны у поля города, когда выбор сделан (TRIP-337). Кольцо загрузки
 * по-прежнему замещает лид (что бы там ни стояло).
 *
 * Правое действие — очистка: `onClear` рисует справа кнопку `×`; вызыватель отдаёт
 * её ТОЛЬКО когда есть что чистить (есть значение), и она гаснет на время загрузки
 * (идёт поиск). Правый отступ резервируется, как только поле ВООБЩЕ очищаемое, —
 * иначе строка дёргалась бы в момент появления `×` (та же причина, что у кольца).
 */
/**
 * ★ `as="button"` — ПОЛЕ, КОТОРОЕ ОТКРЫВАЕТ ВЫБОР, А НЕ ПРИНИМАЕТ ВВОД.
 * Это не второй объект и не «поле-обманка»: коробка, скин, лид-иконка, кольцо и
 * `×` те же самые, меняется только КОНТРОЛ внутри — `<button>` вместо `<input>`,
 * а значение приезжает детьми, потому что у кнопки нет `value`.
 *
 * Роль существует в приложении давно: `SearchSelect` (валюта, язык) ровно так и
 * рисует свой триггер — `<button className="input">` со своими инлайнами. Здесь
 * эта форма объявлена примитивом, а инлайны переехали в правило `button.input`.
 *
 * ★★ ПОЧЕМУ ЭТО НЕСУЩЕЕ, А НЕ УДОБСТВО. Текстовое поле НА СТРАНИЦЕ, открывающее
 * шторку, тревожит саму страницу, и неизбежно: тап фокусирует его, браузер
 * поднимает клавиатуру, вьюпорт раскладки ужимается под неё и страница
 * доскролливается к полю — всё это ДО того, как шторка появилась. Шторка потом
 * накрывает уже уехавшую страницу, а на закрытии та возвращается. Полный рост
 * шторки тут бессилен: дёргается не она, а то, что под ней.
 * У кнопки поднимать клавиатуру нечему, доскролливать как к полю ввода — нечего.
 * Поэтому панели города и события (`.lp-sheet`, открываются кликом по строке)
 * страницу никогда не тревожили, а пикер с полем-триггером — тревожил.
 * Цена ровно одна и она уже принята для валюты и языка: на iOS клавиатура
 * поднимается не тапом по триггеру, а когда тронешь поле поиска ВНУТРИ шторки —
 * так же ведут себя системные пикеры.
 *
 * ⚠️ АННОТАЦИЯ СТОИТ НА ПАРАМЕТРЕ, А НЕ ПЕРЕД `const`: у `forwardRef` функция —
 * это АРГУМЕНТ, и JSDoc перед объявлением к ней не относится. Промах молчит не
 * до конца: пропы схлопываются в `RefAttributes<any>`, и краснеют ВЫЗЫВАТЕЛИ
 * (20 штук), а не этот файл. Та же грабля разобрана в `design/IconBtn` (TRIP-388).
 */
export const Input = React.forwardRef(
  /**
   * @param {{ icon?: string, iconNode?: any, loading?: boolean, onClear?: any,
   *   clearLabel?: string, num?: boolean, className?: string, boxRef?: any,
   *   as?: 'input' | 'button', children?: any }
   *   & import('react').ComponentPropsWithoutRef<'input'>} p
   * @param {any} ref
   */
  ({ icon, iconNode, loading, onClear, clearLabel, num, className = '', boxRef, as = 'input', children, ...rest }, ref) => {
  const required = React.useContext(RequiredCtx);
  const isButton = as === 'button';
  const hasLead = Boolean(icon || iconNode);
  const ringReplacesLead = Boolean(loading && hasLead);
  // Правый слот: кольцо у поля БЕЗ лид-иконки, либо кнопка очистки. `×` скрыта на
  // время загрузки. Резерв справа — как только поле очищаемое ИЛИ грузящееся-без-иконки.
  const ringRight = Boolean(loading && !hasLead);
  const showClear = Boolean(onClear && !loading);
  const hasEnd = onClear !== undefined || (!hasLead && loading !== undefined);
  const boxClass = ['input-affix', hasLead && 'input-affix--ic', hasEnd && 'input-affix--end', className]
    .filter(Boolean).join(' ');
  // Канон-кольцо базовой ступени (18px): она и означает «рядом со строкой
  // текста». Своих ручек размера не даём - у примитива их три ступени, и
  // четвёртая под один вызов вернула бы зоопарк под общим префиксом.
  const ring = <span className="spin spin--ring" />;
  return (
    <div className={boxClass} ref={boxRef}>
      {/* Обязательность — свойство ПОЛЯ ВВОДА: у кнопки-триггера нет ни значения,
          ни встроенной валидации, и `required` на ней ничего не значил бы. */}
      {isButton
        ? <button type="button" className="input row row--g4" ref={ref} {...rest}>{children}</button>
        : <input className={num ? 'input num' : 'input'} ref={ref} {...requiredAttrs(rest.required ?? required)} {...rest} />}
      {hasLead && (
        <span className="input-affix__ic" aria-hidden="true">
          {ringReplacesLead ? ring : (iconNode || <Icon name={icon} size={16} />)}
        </span>
      )}
      {(ringRight || showClear) && (
        <span className="input-affix__end">
          {ringRight ? (
            <span aria-hidden="true">{ring}</span>
          ) : (
            <button
              type="button"
              className="input-affix__clear"
              /* preventDefault on mousedown: without it, mousedown here shifts focus
                 → a focus-driven parent (the `:has(:focus-within)` field-row widen,
                 the Autocomplete dropdown) re-renders BETWEEN mousedown and mouseup,
                 so the two land on different elements and no `click` ever fires — the
                 × read as "clicked the input" and never cleared (root cause of #9). */
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClear}
              aria-label={clearLabel}
              tabIndex={-1}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
      )}
    </div>
  );
  });
Input.displayName = 'Input';

// Пара к <Input> для многострочного поля: тот же канон `.textarea`, декораций
// у него нет, поэтому и обёртки-позиционера нет - внешний класс идёт на само
// поле.
/** @param {{ className?: string } & import('react').ComponentPropsWithoutRef<'textarea'>} p */
export const Textarea = ({ className = '', ...rest }) => {
  const required = React.useContext(RequiredCtx);
  return (
    <textarea
      className={className ? `textarea ${className}` : 'textarea'}
      {...requiredAttrs(rest.required ?? required)}
      {...rest}
    />
  );
};

/**
 * Несколько контролов, читающихся как ОДНО поле: сумма + валюта, цена «от/до»,
 * композер чата. Рамку, радиус, фон и все состояния держит КОНТЕЙНЕР, дети идут
 * без собственной рамки - поэтому у поля нет и не нужен вариант «без рамки».
 * Фокус - `:focus-within` на контейнере: подсветиться должна вся группа.
 * Состояние валидации приходит теми же атрибутами, что и полю, но красит
 * контейнер: у детей рамки нет, красить нечего.
 */
/** @param {{ className?: string, children?: any } & import('react').ComponentPropsWithoutRef<'div'>} p */
export const InputGroup = ({ className = '', children, ...rest }) => (
  <div className={className ? `input-group ${className}` : 'input-group'} {...rest}>
    {children}
  </div>
);
