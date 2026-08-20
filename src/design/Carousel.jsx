// @ts-check
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { IconBtn } from './IconBtn';

// ----- Carousel ----- (горизонтальная лента-примитив ДС)
// Обёртка-скроллер: дети (миниатюры/карточки/что угодно) едут горизонтальной
// лентой с нативным `scroll-snap`. Скроллбар СКРЫТ (это карусель, не скролл-панель)
// — Mobile-first свайп на тач-устройстве. На десктопе (`@media (hover:hover)`)
// стрелки ◄► ПЛАВАЮТ поверх боковых краёв ленты и всплывают только при наведении
// на саму карусель (`.carousel:hover`), листая на ~страницу; каждая видна ТОЛЬКО
// когда в ту сторону есть куда ехать (иначе не рендерится). Своей раскладки у ленты
// нет — она НЕ знает про пресеты обложек: вызыватель кладёт внутрь любые элементы
// (у нас — `<Swatch>`-миниатюры).
//
// ariaLabel — имя ленты для скринридера (обязателен: это интерактивная группа).
// prevLabel/nextLabel — подписи стрелок (i18n из вызывателя, правило #4). Строки
// не хардкодим тут: примитив ДС не знает про язык, как `IconBtn ariaLabel`.
export const Carousel = React.forwardRef(
  /**
   * @param {{
   *   children?: any,
   *   className?: string,
   *   ariaLabel: string,
   *   prevLabel: string,
   *   nextLabel: string,
   * } & Record<string, any>} p
   */
  ({ children, className = "", ariaLabel, prevLabel, nextLabel, ...rest }, ref) => {
    const trackRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(false);

    // Пересчёт краёв: скрываем стрелку, когда в ту сторону ехать некуда (или лента
    // целиком помещается — тогда обе стрелки прячутся). 1px допуск на дробный zoom.
    const sync = useCallback(() => {
      const el = trackRef.current;
      if (!el) return;
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    }, []);

    useEffect(() => {
      sync();
      const el = trackRef.current;
      if (!el || typeof ResizeObserver === 'undefined') return undefined;
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      return () => ro.disconnect();
    }, [sync, children]);

    const page = (dir) => {
      const el = trackRef.current;
      if (!el) return;
      el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
    };

    return (
      <div className={["carousel", className].filter(Boolean).join(" ")} ref={ref}>
        <div
          className="carousel__track"
          ref={trackRef}
          onScroll={sync}
          role="group"
          aria-label={ariaLabel}
          {...rest}
        >
          {children}
        </div>
        {!atStart && (
          <IconBtn
            icon="chevL"
            ariaLabel={prevLabel}
            tone="soft"
            round
            className="carousel__nav carousel__nav--prev"
            tabIndex={-1}
            onClick={() => page(-1)}
          />
        )}
        {!atEnd && (
          <IconBtn
            icon="chev"
            ariaLabel={nextLabel}
            tone="soft"
            round
            className="carousel__nav carousel__nav--next"
            tabIndex={-1}
            onClick={() => page(1)}
          />
        )}
      </div>
    );
  },
);
Carousel.displayName = "Carousel";
