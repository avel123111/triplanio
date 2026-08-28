// @ts-check
import React, { useState } from 'react';

// Единый путь к фоллбек-обложке (бандл/CDN Vercel, `public/covers/fallback.webp`).
// JS-источник для мест, что рендерят обложку своим <img> (карточки трипов,
// StepReview); CSS-подложка `.cover` держит тот же файл литералом (слои разные).
export const COVER_FALLBACK = '/covers/fallback.webp';

// ----- Cover ----- (обложка трипа как примитив ДС)
// Нижний слой `.cover` ВСЕГДА несёт фоллбек-картинку из бандла
// (`public/covers/fallback.webp`) поверх нейтральной подложки — она видна, когда
// обложки нет. Фото (если есть) — `<img class="cover__img">` ПОВЕРХ фоллбека; его
// `onError` гасит img → снова просвечивает фоллбек, поэтому один примитив закрывает
// и «нет обложки», и «битый/протухший src» (напр. истёкший signed URL своей фотки).
// Градиентов больше нет — дефолтная обложка = картинка, а не цвет.
//
// image — URL фото; пусто/битый → виден фоллбек.
//
// ★ `fill` — обложка НА ВСЮ ПЛОЩАДЬ родителя (`position:absolute; inset:0`)
// вместо собственной миниатюры 62×46. Заведено вместе с постером трипа: до
// этого «во всю карточку» рисовалось сырым `<img class="tc__img">` со своей
// копией фоллбека (`src={url || COVER_FALLBACK}`) и БЕЗ `onError` — битый или
// удалённый URL показывал сломанную картинку вместо плейсхолдера. Одна ось
// вместо второй реализации того же слоя.
export const Cover = React.forwardRef(
  /**
   * @param {{
   *   image?: string | null,
   *   fill?: boolean,
   *   className?: string,
   *   children?: any,
   * } & Record<string, any>} p
   */
  ({ image, fill, className = "", children, ...rest }, ref) => {
    // Провал храним URL'ом, а не булевым флагом: при смене фото новый src !==
    // failedUrl → img показывается снова без useEffect на сброс.
    const [failedUrl, setFailedUrl] = useState(/** @type {string | null} */ (null));
    const showImg = image && image !== failedUrl;
    return (
      <span
        ref={ref}
        className={["cover", fill && "cover--fill", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {showImg ? (
          <img className="cover__img" src={image} alt="" onError={() => setFailedUrl(image)} />
        ) : null}
        {children}
      </span>
    );
  },
);
Cover.displayName = "Cover";
