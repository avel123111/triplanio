// @ts-check
import React, { useEffect, useRef } from 'react';

// ----- Carousel ----- (горизонтальная лента-примитив ДС)
// Обёртка-скроллер: дети (миниатюры/карточки/что угодно) едут горизонтальной
// лентой с нативным `scroll-snap`. Скроллбар СКРЫТ — Mobile-first свайп на тач-
// устройстве, колесо/трекпад на десктопе. СТРЕЛОК НЕТ намеренно: кнопки, листающие
// то, что и так листается скроллом, — дубль (фидбэк Pavel). Если экрану нужны
// стрелки «сменить элемент», их место — у самого элемента (у обложки), а не в ленте.
// Своей раскладки/содержимого у ленты нет — она НЕ знает про пресеты обложек:
// вызыватель кладёт внутрь любые элементы (у нас — `<Swatch>`-миниатюры).
//
// ★ КОЛЕСО МЫШИ ЛИСТАЕТ ЛЕНТУ ГОРИЗОНТАЛЬНО (десктоп). У ряда только
// горизонтальный оверфлоу, а обычное колесо даёт вертикальный `deltaY` — без
// этого лента на десктопе мышью не двигалась (палец на тач-устройстве двигает её
// свайпом, у мыши пути не было — просьба Ильи). Нативный listener с
// `passive:false`; `preventDefault` ТОЛЬКО когда лента реально переполнена и есть
// вертикальный delta — иначе страница под лентой скроллится как обычно.
//
// ariaLabel — имя ленты для скринридера (обязателен: это группа прокрутки).
// ref пробрасывается на корень `.carousel` (вызыватель может доскроллить выбранный
// элемент к центру через `ref.current.querySelector(...).scrollIntoView`).
export const Carousel = React.forwardRef(
  /**
   * @param {{
   *   children?: any,
   *   className?: string,
   *   ariaLabel: string,
   * } & Record<string, any>} p
   */
  ({ children, className = "", ariaLabel, ...rest }, ref) => {
    const innerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    // Свой ref держим всегда (для wheel-эффекта) и одновременно отдаём наружу:
    // вызыватель тоже читает корень (доводчик выбранной миниатюры к центру).
    const setRef = (/** @type {HTMLDivElement | null} */ node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return undefined;
      const onWheel = (/** @type {WheelEvent} */ e) => {
        if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);

    return (
      <div
        className={["carousel", className].filter(Boolean).join(" ")}
        ref={setRef}
        role="group"
        aria-label={ariaLabel}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
Carousel.displayName = "Carousel";
