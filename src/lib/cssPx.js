// @ts-check

/**
 * Сколько CSS-величина занимает В ПИКСЕЛЯХ.
 *
 * ★ ЗАЧЕМ ЗОНД, А НЕ `getComputedStyle`. Для custom property он отдаёт ЗАПИСЬ
 * (`calc(...)`, `env(...)`, `min(...)`), а не результат — то есть числа из неё
 * не получить. Единственный честный способ — дать величину настоящему элементу
 * и померить его. Зонд невидим, живёт один кадр и на раскладку не влияет.
 *
 * Нужен там, где число объявлено в CSS, а решение принимается в JS: высота
 * дока, радиус скруглений. Обратное направление (JS → CSS) делается проще —
 * примитив публикует переменную на своём корне.
 *
 * @param {string} value любая CSS-длина, например `var(--r-xl)` или `12px`
 * @returns {number} пиксели
 */
export function cssPx(value) {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;bottom:0;left:0;width:0;height:${value};visibility:hidden;pointer-events:none;`;
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height || 0;
  probe.remove();
  return h;
}

export default cssPx;
