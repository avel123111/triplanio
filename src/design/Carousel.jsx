// @ts-check
import React from 'react';

// ----- Carousel ----- (горизонтальная лента-примитив ДС)
// Обёртка-скроллер: дети (миниатюры/карточки/что угодно) едут горизонтальной
// лентой с нативным `scroll-snap`. Скроллбар СКРЫТ — Mobile-first свайп на тач-
// устройстве, колесо/трекпад на десктопе. СТРЕЛОК НЕТ намеренно: кнопки, листающие
// то, что и так листается скроллом, — дубль (фидбэк Pavel). Если экрану нужны
// стрелки «сменить элемент», их место — у самого элемента (у обложки), а не в ленте.
// Своей раскладки/содержимого у ленты нет — она НЕ знает про пресеты обложек:
// вызыватель кладёт внутрь любые элементы (у нас — `<Swatch>`-миниатюры).
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
  ({ children, className = "", ariaLabel, ...rest }, ref) => (
    <div
      className={["carousel", className].filter(Boolean).join(" ")}
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      {...rest}
    >
      {children}
    </div>
  ),
);
Carousel.displayName = "Carousel";
