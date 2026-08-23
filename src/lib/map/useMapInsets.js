// @ts-check
import { useEffect, useRef } from 'react';
import { NO_INSETS, canFrame, getMapInsets, setMapInsets } from './insets';

/**
 * Механика закрытой площади для экрана с картой (TRIP-422).
 *
 * ★ Четыре правила обращения, и на каждом легко ошибиться:
 *   1. объявить отступ ДО первого кадрирования;
 *   2. на ПЕРВОМ применении не анимировать, на последующих — доехать вместе с
 *      поверхностью;
 *   3. не кадрировать, когда свободного окна не осталось (`canFrame`);
 *   4. снимать отступ РОВНО на размонтировании.
 *
 * Правило 4 — самое коварное: сложи уборку с применением в один эффект, и React
 * позовёт её перед каждым перезапуском, то есть на каждой осадке детента —
 * отступ рывком уйдёт в ноль за кадр до плавного доезда.
 *
 * @param {{ current: any }} mapRef ссылка на инстанс (общий синглтон)
 * @param {{
 *   ready: boolean,
 *   insets: any,
 *   slotPx?: number,
 *   onReframe: (map: any) => void,
 * }} p `onReframe` — «перекадрируй текущую цель»; зовётся только когда есть куда.
 */
export function useMapInsets(mapRef, { ready, insets, slotPx = 0, onReframe }) {
  // ★ КЛЮЧ — ВСЁ СВОБОДНОЕ ОКНО, А НЕ ТОЛЬКО ОТСТУПЫ КАМЕРЫ. Свободное окно
  // меняют ДВЕ вещи, по одной на ось: ширину — отступ камеры (панель), высоту —
  // размер СЛОТА (шит). Ключ только по отступам означал, что на телефоне
  // перекадрирования нет вовсе: там отступы всегда нулевые, а меняется слот.
  // Ровно это и выглядело как «края маршрута за кадром» и «зум скачком».
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
    if (!map || !ready) return;
    liveRef.current = map;
    setMapInsets(map, insets);
    if (!seenRef.current) {
      seenRef.current = true;
      try { map.easeTo({ padding: getMapInsets(map), duration: 0 }); } catch { /* ignore */ }
      return undefined;
    }
    // ★ КАДРИРУЕМ ПОСЛЕ ТОГО, КАК ХОЛСТ ПРИНЯЛ НОВЫЙ РАЗМЕР. Слот меняет высоту
    // через CSS-переменную, mapbox узнаёт об этом от ResizeObserver — то есть
    // ПОЗЖЕ нашего рендера. Кадрировать раньше значит вписать маршрут в старый
    // размер: он и оказывается краями за кадром. Два кадра + явный `resize()`
    // (идемпотентный) гарантируют, что считаем по фактическому холсту.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = mapRef.current;
      if (!m) return;
      try { m.resize(); } catch { /* ignore */ }
      const el = m.getContainer?.();
      if (!canFrame(el?.clientWidth || 0, el?.clientHeight || 0, getMapInsets(m))) return;
      reframeRef.current(m);
    }));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // Уборка — ОТДЕЛЬНЫМ эффектом с пустыми зависимостями (правило 4 выше).
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
