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
// ★ ПЕРЕТАСКИВАНИЕ МЫШЬЮ (десктоп): зажал ЛКМ и тянешь — ряд едет за курсором,
// ровно как палец двигает ленту свайпом на тач-устройстве (просьба Pavel). Только
// мышь (`pointerType==='mouse'`): у тача уже есть нативный свайп, и перехват сломал
// бы его инерцию. Захват курсора и подмена `scrollLeft` включаются лишь ПОСЛЕ
// порога сдвига (иначе обычный клик по миниатюре — это выбор, а не перетаскивание);
// клик, случившийся ПОСЛЕ реального перетаскивания, гасится, чтобы «дотащил и
// отпустил на другой миниатюре» не сменил выбор.
//
// ★ КОЛЕСО МЫШИ ТОЖЕ ЛИСТАЕТ ЛЕНТУ ГОРИЗОНТАЛЬНО (десктоп, просьба Ильи): у ряда
// только горизонтальный оверфлоу, а обычное колесо даёт вертикальный `deltaY`.
// Нативный listener с `passive:false`; `preventDefault` ТОЛЬКО когда лента реально
// переполнена — иначе страница под лентой скроллится как обычно.
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

      // Колесо → горизонталь.
      const onWheel = (/** @type {WheelEvent} */ e) => {
        if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      };

      // Перетаскивание мышью. `moved` отделяет клик по миниатюре (выбор) от
      // протяжки (скролл): захват курсора и подмена scrollLeft включаются только
      // после порога DRAG_THRESHOLD, а состоявшийся клик после протяжки гасим.
      const DRAG_THRESHOLD = 4; // px
      let down = false;
      let moved = false;
      let startX = 0;
      let startLeft = 0;
      const onPointerDown = (/** @type {PointerEvent} */ e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        if (el.scrollWidth <= el.clientWidth) return;
        down = true;
        moved = false;
        startX = e.clientX;
        startLeft = el.scrollLeft;
      };
      const onPointerMove = (/** @type {PointerEvent} */ e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) > DRAG_THRESHOLD) {
          moved = true;
          // Захват держит pointermove за лентой, даже когда курсор ушёл за её край.
          try { el.setPointerCapture(e.pointerId); } catch { /* pointer уже отпущен */ }
          el.style.cursor = "grabbing";
          el.style.userSelect = "none";
        }
        if (moved) { el.scrollLeft = startLeft - dx; e.preventDefault(); }
      };
      const endDrag = () => {
        down = false;
        el.style.cursor = "";
        el.style.userSelect = "";
        // `moved` НЕ сбрасываем здесь: click после pointerup ещё впереди, и его
        // гасит onClickCapture (там же moved сбрасывается). Новый pointerdown тоже
        // обнуляет moved — одиночный клик после протяжки отработает нормально.
      };
      const onClickCapture = (/** @type {MouseEvent} */ e) => {
        if (!moved) return;
        e.stopPropagation();
        e.preventDefault();
        moved = false;
      };

      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", endDrag);
      el.addEventListener("pointercancel", endDrag);
      el.addEventListener("click", onClickCapture, true);
      return () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", endDrag);
        el.removeEventListener("pointercancel", endDrag);
        el.removeEventListener("click", onClickCapture, true);
      };
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
