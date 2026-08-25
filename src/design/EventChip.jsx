// @ts-check
import React from 'react';
import { eventFamily } from './eventFamily';

// ----- EventChip ----- (TRIP-321 линза «Календарь» — апрув Pavel)
// Компактный «эвент-токен» календаря: до этого три почти одинаковые формы под
// своими классами — чип события в СЕТКЕ МЕСЯЦА (`.ncal-ev`), all-day-чип в
// ШАПКЕ НЕДЕЛИ (`.ncal-chip`) и timed-карточка в ТАЙМ-ГРИДЕ недели (`.ncal-tev`).
// Один примитив, ось `variant`:
//   · `inline` — строка чипа (время слева + заголовок), левый цветной кант;
//   · `allday` — плоская пилюля-плашка (заголовок);
//   · `block`  — позиционируемая карточка (время над заголовком; координаты
//                приходят `style`-ом от тайм-грида).
// Цвет — семейство события (`eventFamily(type)` → класс `ev-<fam>` + токены
// `--ev-*`), тот же источник, что у таймлайна.
//
// ★ БАЗА `<button>` при `onClick` (открыть панель события), иначе `<div>`.

/** @typedef {'inline'|'allday'|'block'} EventChipVariant */
/**
 * ★ ОБЯЗАТЕЛЕН ТОЛЬКО `title` — остальное имеет осмысленный дефолт: у `allday`
 * времени НЕТ по построению (событие без часа), координаты `style` приходят
 * только у `block` из тайм-грида, а декоративный чип живёт без `onClick`. Форма
 * `@param {object}` требовала бы каждый ключ и роняла экран под `// @ts-check`
 * на законных вызовах — разбор этой ловушки в шапке `Layout.jsx`.
 * @param {{ type?: string, variant?: EventChipVariant, time?: any, title: any,
 *           onClick?: any, ariaLabel?: string, className?: string, style?: any }} p
 */
export const EventChip = ({ type, variant = 'inline', time, title, onClick, ariaLabel, className = '', style }) => {
  const El = /** @type {any} */ (onClick ? 'button' : 'div');
  const fam = `ev-${eventFamily(type)}`;
  return (
    <El
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={['evchip', `evchip--${variant}`,
        // раскладка — канон .row (ось зазора g3 у inline); `block` держит свою
        // колонку: зазор 1px вне шкалы --sp-N, ступени под него нет.
        variant === 'inline' && 'row row--g3', variant === 'allday' && 'row',
        fam, className].filter(Boolean).join(' ')}
      style={style}
    >
      {time != null && time !== '' && <span className="evchip__tm">{time}</span>}
      <span className="evchip__t">{title}</span>
    </El>
  );
};

/** @type {readonly EventChipVariant[]} */
export const EVENTCHIP_VARIANTS = ['inline', 'allday', 'block'];
