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
/** @param {{ icon?: string, loading?: boolean, num?: boolean, className?: string, boxRef?: any } & import('react').ComponentPropsWithoutRef<'input'>} p */
export const Input = ({ icon, loading, num, className = '', boxRef, ...rest }) => {
  const required = React.useContext(RequiredCtx);
  // Кольцо загрузки ЗАМЕЩАЕТ стартовую иконку: у поля один индикатор и одно
  // место под него, а правая сторона остаётся свободной под действие. Ширина
  // текстовой зоны при этом не меняется вовсе, поэтому резерв справа, который
  // держали против дёрганья при наборе (TRIP-277), тут не нужен.
  // ★У поля БЕЗ иконки замещать нечего - там кольцо остаётся справа, и резерв
  // ему по-прежнему нужен: иначе отступ включится вместе со спиннером и поле
  // дёрнется. Резервируется, как только вызов ВООБЩЕ умеет грузиться, даже при
  // `loading={false}`.
  const ringReplacesIcon = Boolean(loading && icon);
  const hasEnd = !icon && loading !== undefined;
  const boxClass = ['input-affix', icon && 'input-affix--ic', hasEnd && 'input-affix--end', className]
    .filter(Boolean).join(' ');
  // Канон-кольцо базовой ступени (18px): она и означает «рядом со строкой
  // текста». Своих ручек размера не даём - у примитива их три ступени, и
  // четвёртая под один вызов вернула бы зоопарк под общим префиксом.
  const ring = <span className="spin spin--ring" />;
  return (
    <div className={boxClass} ref={boxRef}>
      <input className={num ? 'input num' : 'input'} {...requiredAttrs(rest.required ?? required)} {...rest} />
      {icon && (
        <span className="input-affix__ic" aria-hidden="true">
          {ringReplacesIcon ? ring : <Icon name={icon} size={16} />}
        </span>
      )}
      {hasEnd && loading && (
        <span className="input-affix__end" aria-hidden="true">{ring}</span>
      )}
    </div>
  );
};

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
