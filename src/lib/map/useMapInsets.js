// @ts-check
import { useEffect, useRef } from 'react';
import { NO_INSETS, canFrame, getMapInsets, setMapInsets } from './insets';
import { SURFACE_SETTLE_MS, surfaceEasing } from '@/lib/surfaceMotion';

/**
 * Механика закрытой площади для экрана с картой (TRIP-422).
 *
 * ★ Три правила обращения, и на каждом легко ошибиться:
 *   1. объявить отступ ДО первого кадрирования;
 *   2. на ПЕРВОМ применении поставить его без анимации (базовая точка отсчёта);
 *   3. снимать отступ РОВНО на размонтировании.
 *
 * Правило 3 — самое коварное: сложи уборку с применением в один эффект, и React
 * позовёт её перед каждым перезапуском, то есть на каждой смене отступа —
 * отступ рывком уйдёт в ноль.
 *
 * ★★ КАРТА ПОД НОВОЕ ОКНО ПОДСТРАИВАЕТСЯ, НО МАРШРУТ НЕ ПЕРЕКАДРИРУЕТ. Это две
 * РАЗНЫЕ вещи, и их легко склеить в одну — так тут и было:
 *   ПОДСТРОЙКА  — отступ доезжает до нового свободного окна: вид переезжает
 *                 вместе с панелью или шитом, ЗУМ И ГРАНИЦЫ НЕ ТРОГАЮТСЯ.
 *                 Без неё свёрнутая панель открывает пустую площадь, а карта
 *                 остаётся прижатой туда, где панель стояла.
 *   АВТОФОКУС   — вписать МАРШРУТ в окно заново, то есть пересчитать зум и центр
 *                 по его границам. Ему место ровно одно — изменение маршрута.
 * Прежде смена окна делала ВТОРОЕ (`reframeTo` вписывал маршрут), и со стороны
 * это читалось как «карта сама наводится», хотя маршрут не менялся. Теперь
 * эффект объявляет закрытую площадь и доводит до неё ОТСТУП — не более.
 *
 * `onReframe` — необязательная дверь для цели, РАЗМЕР которой считается от
 * ХОЛСТА, а не от маршрута (пустой глобус планировщика: диаметр шара — доля
 * высоты канваса, и при смене слота он обязан пересчитаться, иначе шар
 * обрезается краем). Вернула `true` — доехала сама, отступ трогать не нужно.
 * Кадрировать в ней МАРШРУТ нельзя: это и был бы тот самый автофокус.
 *
 * @param {{ current: any }} mapRef ссылка на инстанс (общий синглтон)
 * @param {{
 *   ready: boolean,
 *   insets: any,
 *   slotPx?: number,
 *   onReframe?: (map: any) => boolean | void,
 * }} p
 */
export function useMapInsets(mapRef, { ready, insets, slotPx = 0, onReframe = null }) {
  // ★ КЛЮЧ — ВСЁ СВОБОДНОЕ ОКНО, А НЕ ТОЛЬКО ОТСТУПЫ КАМЕРЫ. Свободное окно
  // меняют ДВЕ вещи, по одной на ось: ширину — отступ камеры (панель), высоту —
  // размер СЛОТА (шит). Слот нужен здесь ради `onReframe`: на телефоне отступы
  // камеры всегда нулевые, и по ним одним пустой глобус не узнал бы, что холст
  // стал другого размера. Экран без `onReframe` слот и не передаёт.
  const key = `${insets?.top || 0}|${insets?.right || 0}|${insets?.bottom || 0}|${insets?.left || 0}|${slotPx}`;
  const seenRef = useRef(false);
  // ★ СОБСТВЕННАЯ ССЫЛКА НА ИНСТАНС, И ЭТО НЕ ДУБЛЬ. `useMapSurface` обнуляет
  // свой `mapRef` в СВОЁМ cleanup, а объявлен он раньше — React зовёт cleanup'ы
  // в порядке объявления, поэтому к нашей уборке `mapRef.current` уже `null`.
  // Опереться на него значит НЕ СНЯТЬ отступ вовсе: карта общая, и следующий
  // экран получил бы её с отрезанной полосой — без единой ошибки в консоли.
  const liveRef = useRef(/** @type {any} */ (null));
  // Свежий колбэк для эффекта, который зависит только от отступа: перекадрирование
  // обязано брать АКТУАЛЬНУЮ цель, но само по смене цели не запускаться.
  const reframeRef = useRef(onReframe);
  reframeRef.current = onReframe;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    liveRef.current = map;
    setMapInsets(map, insets);
    if (!seenRef.current) {
      seenRef.current = true;
      try { map.easeTo({ padding: getMapInsets(map), duration: 0 }); } catch { /* ignore */ }
      return undefined;
    }
    // ★ ДОВОДИМ ПОСЛЕ ТОГО, КАК ХОЛСТ ПРИНЯЛ НОВЫЙ РАЗМЕР. Слот меняет высоту
    // через CSS-переменную, mapbox узнаёт об этом от ResizeObserver — то есть
    // ПОЗЖЕ нашего рендера. Посчитать раньше значит посчитать по старому
    // размеру. Два кадра + явный `resize()` (идемпотентный) гарантируют, что
    // считаем по фактическому холсту.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = mapRef.current;
      if (!m) return;
      try { m.resize(); } catch { /* ignore */ }
      const el = m.getContainer?.();
      if (!canFrame(el?.clientWidth || 0, el?.clientHeight || 0, getMapInsets(m))) return;
      // Цель, размер которой считается от холста, обслуживает себя сама.
      if (reframeRef.current?.(m)) return;
      // Иначе доезжает ТОЛЬКО отступ — тем же временем и той же кривой, что и
      // поверхность, которая поехала (шит встаёт на детент за `SURFACE_SETTLE_MS`,
      // панель уезжает за него же). Ни `center`, ни `zoom` тут не передаются, и
      // это ГЛАВНОЕ: mapbox сам сдвигает вид в новое свободное окно, а границы
      // маршрута в расчёт не входят — подстройка есть, автофокуса нет.
      try { m.easeTo({ padding: getMapInsets(m), duration: SURFACE_SETTLE_MS, easing: surfaceEasing }); } catch { /* ignore */ }
    }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // Уборка — ОТДЕЛЬНЫМ эффектом с пустыми зависимостями (правило 3 выше).
  // Инстанс карты общий и живёт дольше экрана: не снять отступ значит отрезать
  // полосу у следующего.
  useEffect(() => () => {
    const map = liveRef.current;
    if (!map) return;
    setMapInsets(map, null);
    try { map.easeTo({ padding: NO_INSETS, duration: 0 }); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default useMapInsets;
