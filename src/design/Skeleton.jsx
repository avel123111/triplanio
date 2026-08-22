// @ts-check
import React from 'react';

// ----- Skeleton ----- (мерцающая заглушка ещё не приехавшего содержимого)
//
// ★ ЖИВЁТ СВОИМ МОДУЛЕМ, а не в барреле `design/index.jsx`, по той же причине,
// что `IconBtn`/`Swatch`/`Stepper`: баррель реэкспортит `components/ui/*`,
// поэтому примитив, взявший заглушку оттуда, замкнул бы кольцо
// `design/index → … → design/index`. Скелетон нужен ВНУТРИ примитивов (лента
// пикера обложки рисует им ещё не приехавшие миниатюры), значит место ему
// рядом с ними. Экраны по-прежнему зовут его через баррель — точка входа в ДС
// остаётся одна.
//
// w/h — размеры (число = px или любая CSS-длина), r — радиус (число или токен).
/**
 * @param {{
 *   w?: number | string,
 *   h?: number | string,
 *   r?: number | string,
 *   style?: React.CSSProperties,
 * }} p
 */
export const Skeleton = ({ w = "100%", h = 14, r = 6, style }) => (
  // inline-style-exempt: размеры заглушки ЕСТЬ её содержимое — она принимает
  // форму того места, которое занимает, и классом это не выразить.
  <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
);
Skeleton.displayName = "Skeleton";
