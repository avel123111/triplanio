// @ts-check
import React from 'react';

// ----- Cover ----- (TRIP-337: обложка трипа как примитив ДС)
// Миниатюра-обложка: фото (если есть) ПОВЕРХ фирменного градиента трипа. Раньше
// это рисовалось ИНЛАЙНОМ (`style={{ background: coverGradientCss(id) }}`) на
// `.tr__thumb`/`.tc__bg` — а инлайн-скин запрещён (всё из ДС/в ДС). Здесь градиент
// — КОНЕЧНЫЙ набор (16 штук, `TRIP_GRADIENTS`), поэтому он живёт КЛАССАМИ в CSS
// (`.cover[data-cover="gradient_N"]`), а не инлайном; выбор — по `data`-атрибуту.
// Фото — это `<img src>` (атрибут, не стиль), поверх градиента.
//
// gradient — id из набора (`gradient_1`…`gradient_16`); дефолт gradient_1.
// image    — URL фото (перекрывает градиент); пусто → виден градиент.
// Дрейф значений CSS↔`TRIP_GRADIENTS` держит тест `Cover.test.js`.
export const Cover = React.forwardRef(
  /**
   * @param {{
   *   gradient?: string,
   *   image?: string | null,
   *   className?: string,
   *   children?: any,
   * } & Record<string, any>} p
   */
  ({ gradient, image, className = "", children, ...rest }, ref) => (
    <span
      ref={ref}
      className={["cover", className].filter(Boolean).join(" ")}
      data-cover={image ? undefined : (gradient || "gradient_1")}
      {...rest}
    >
      {image ? <img className="cover__img" src={image} alt="" /> : null}
      {children}
    </span>
  ),
);
Cover.displayName = "Cover";
