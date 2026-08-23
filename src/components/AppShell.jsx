// @ts-check
/**
 * AppShell — ГЕОМЕТРИЯ оболочки приложения. Один ящик, две начинки.
 *
 * ★ ЗАЧЕМ ПРИМИТИВ. До этого оболочек снова было ДВЕ: `.trip-shell/.trip-body/
 * .trip-content` у экранов трипа и `.flow-page` у флоу создания. Собранные
 * порознь, они и разъехались по геометрии — и это не косметика, а причина
 * рывков при переходе «создал трип → открыть трип»: рейл трипа занимает
 * колонку `--rail-w`, у флоу такой колонки не было, поэтому в один кадр
 * смены роута виджет прыгал на 70px вправо, а холст карты менял ширину
 * (1440 → 1370 на 1440px окне). Анимировать это нельзя: смена размера холста —
 * переаллокация GL-буфера на каждый кадр (разбор в `lib/mapShellInsets.js`).
 * Единственное лекарство — чтобы менять было НЕЧЕГО.
 *
 * TRIP-349 уже свёл к одной оболочке трип-экраны и редактор маршрута. Здесь тот
 * же ход доведён до флоу создания: геометрия вынута из `TripShell` как есть
 * (те же классы, те же правила — CSS не тронут), а трип-специфика — рейл с
 * секциями, шапка трипа, регистрация мобильного дока — осталась в `TripShell`,
 * который теперь этот примитив СОБИРАЕТ. «Бес-трипного режима» у `TripShell` не
 * появилось: это была бы вторая оболочка под видом флага.
 *
 * Слоты — потому что позиция в DOM у них несущая, а не косметическая:
 *   rail     — левая колонка (`--rail-w`), обе строки сетки
 *   header   — правая верхняя ячейка; СОСЕД `.trip-content`, а не его потомок:
 *              к `.trip-content` абсолютом привязаны хосты выдвижных панелей
 *              (`.evd-drawer`, `.ts-pdrawer`), и внутри шапки они поехали бы
 *              из-под неё
 *   children — тело секции, внутри скроллящегося `main`
 *   drawer   — внутри `.trip-content` ПОСЛЕ `main`: не должен скроллиться с
 *              содержимым, поэтому сосед `main`, а не его потомок
 *   overlays — после `.trip-body`: диалоги, шиты, плавающий виджет чата
 */
import React, { useEffect, useRef } from 'react';
import { SURFACE_EASE_CSS, SURFACE_SETTLE_MS } from '@/lib/surfaceMotion';

// Темп входа берётся из ОБЩЕГО контракта движения (`lib/surfaceMotion.js`), а не
// пишется числом в CSS: тем же временем и той же кривой едут шит, камера карты и
// плавающие контролы. Публикуем переменными на корне оболочки — ровно тем приёмом,
// каким это делают MapShell и PeekSheet, и каким нав публикует свою высоту.
// Константа МОДУЛЬНАЯ: значения приходят из модуля, зависимостей нет, и `useMemo`
// над таким объектом только делает вид, что что-то считает.
const MOTION_STYLE = {
  '--surface-settle': `${SURFACE_SETTLE_MS}ms`,
  '--surface-ease': SURFACE_EASE_CSS,
};

/**
 * @param {{ rail?: any, header?: any, children?: any, drawer?: any, overlays?: any,
 *           flush?: boolean, entering?: string | null, bodyRef?: any, resetScrollKey?: any }} p
 */
export default function AppShell({
  rail = null,
  header = null,
  children,
  drawer = null,
  overlays = null,
  // Секция сама владеет своим скроллом (карта, чат, редактор маршрута, флоу
  // создания): тело без паддинга и без скролла, поверхность в край.
  flush = false,
  // «Как сюда попали» — ФАКТ на оболочке, а не анимация, прописанная в детали.
  // Читателя у него сегодня ровно один (въезд рейла), и объявлен он в CSS.
  entering = null,
  bodyRef,
  // Смена этого значения возвращает тело наверх. Ключ, а не эффект у вызывателя:
  // тело — постоянный скролл-контейнер (сама оболочка не скроллится), и вернуть
  // его наверх обязана та, кто им владеет.
  resetScrollKey = null,
}) {
  const ownBodyRef = useRef(/** @type {any} */ (null));
  const mainRef = bodyRef || ownBodyRef;
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [resetScrollKey, mainRef]);

  return (
    <div className="trip-shell" data-entering={entering || undefined} style={MOTION_STYLE}>
      <div className="trip-body">
        {rail}
        {header}
        <div className="trip-content">
          <main ref={mainRef} className={'trip-screen-body' + (flush ? ' trip-screen-body--flush' : '')}>
            {children}
          </main>
          {drawer}
        </div>
      </div>
      {overlays}
    </div>
  );
}
