import { useEffect, useState } from 'react';

// Граница «десктоп ↔ телефон» неавторизованной зоны — ОДНО число.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ (TRIP-465). Это не новый брейкпоинт: 981 уже живёт
// в `public/site.css` одиннадцатью правилами (`min-width:981px` ×6 и
// `max-width:980px` ×5) и один раз в JS — литералом в кадрировании героя
// лендинга. Оглавление юр-страниц становится вторым потребителем в JS, то есть
// ТРЕТЬЕЙ копией числа. Разъедься они на единицу — и раскладка CSS разойдётся
// с решением JS в полосе шириной в один пиксель: дефект, который не видно
// никаким скриншотом и который никто не воспроизведёт.
//
// ★ Это НЕ граница приложения. У приложения своя, одна и своя намеренно —
// `PHONE_MAX_W = 640` в `src/hooks/use-mobile.jsx` (TRIP-349, там разобрано,
// чем стоила попытка держать две). Зона живёт на собственной ДС и на
// собственной сетке; брать 640 сюда значило бы переключать оглавление не там,
// где переключается его же CSS.
//
// Два написания одного числа — не два источника: оба выводятся из него. В CSS
// зоны обе формы тоже реально встречаются, поэтому обе и объявлены.

/** Ширина, с которой зона считается десктопом (px). Совпадает с `site.css`. */
export const ZONE_DESKTOP_MIN = 981;

/** «Это десктоп» — та же граница, что у `@media (min-width:981px)`. */
export const ZONE_DESKTOP_MQ = `(min-width:${ZONE_DESKTOP_MIN}px)`;

/** «Это НЕ десктоп» — та же граница, что у `@media (max-width:980px)`. */
export const ZONE_BELOW_DESKTOP_MQ = `(max-width:${ZONE_DESKTOP_MIN - 1}px)`;

/**
 * Реактивная проверка «зона на десктопе». Идиома взята у `useIsPhone`
 * приложения (синхронный инициализатор + повторное чтение в эффекте, потому
 * что значение могло измениться между ними) — меняется только сам запрос.
 *
 * @returns {boolean}
 */
export function useZoneDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(ZONE_DESKTOP_MQ).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(ZONE_DESKTOP_MQ);
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
