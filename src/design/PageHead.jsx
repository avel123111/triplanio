// @ts-check
import React from 'react';

// ----- PageHead ----- (TRIP-413, объект «шапка экрана»)
// Шапка экрана: слева заголовок (канон `.t-title`) + необязательный подзаголовок,
// справа необязательные действия (кнопки). Все три части опциональны.
//
// ★ ЗАЧЕМ. Каждый экран рисовал свою шапку под своим именем (`bgt-head`,
// `acct-hero`, `dl-head`, …) — один и тот же объект в N пространствах имён.
// Здесь он объявлен ОДИН раз; экраны зовут его через баррель и удаляют свои копии.
//
// ★ АДАПТИВ — НЕ ЗДЕСЬ. Прятать действия на мобиле (кнопка уехала в FAB) — это
// решение ЭКРАНА (данные), а не облик шапки: экран просто не передаёт `actions`
// на мобиле (`useIsMobile`). Компонент всегда рисует то, что дали, — так он
// переиспользуем, а не заточен под один экран.
//
// ★ БАЗА = `<div>`: остаток пропов (`data-*`/`aria-*`/`id`) уезжает на носитель.
export const PageHead = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<'div'> & {
   *   title?: any,
   *   subtitle?: any,
   *   actions?: any,
   *   children?: any,
   * }} p
   */
  ({ title, subtitle, actions, className = "", children, ...rest }, ref) => (
    <div
      ref={ref}
      className={["pagehead", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {(title || subtitle) && (
        <div className="pagehead__titles">
          {title && <h2 className="t-title pagehead__title">{title}</h2>}
          {subtitle && <div className="t-meta pagehead__sub">{subtitle}</div>}
        </div>
      )}
      {(actions || children) && (
        <div className="pagehead__actions">{actions || children}</div>
      )}
    </div>
  ),
);
PageHead.displayName = "PageHead";
