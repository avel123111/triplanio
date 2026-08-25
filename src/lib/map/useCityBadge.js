// @ts-check
import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { createCityBadgeEl } from './markers';

// Снять попап, не падая, если его уже нет.
const safeRemove = (x) => { try { x.remove(); } catch { /* ignore */ } };

/**
 * Стеклянная плашка «флаг + город + даты» у активного города (линза «Маршрут»/
 * редактор и планировщик). Несётся `mapboxgl.Popup` без фиксированного `anchor`,
 * поэтому mapbox сам разворачивает её той стороной, что держит на экране.
 *
 * `cityBadge` — `{ lng, lat, countryCode, name, dates, actionLabel?, onAction?,
 * ctaOn? } | null`. `null` (и hotel-pick у редактора через `enabled=false`)
 * снимает плашку. `onAction` (+ `actionLabel`) даёт бейджу CTA-шеврон «открыть
 * город» (двухшаговый клик в редакторе); `ctaOn` раскрывает/сворачивает его.
 *
 * ★ ПОПАП ЖИВЁТ ПО ГОРОДУ, А НЕ ПО НАЛИЧИЮ CTA. Фиксация города переключает
 * ТОЛЬКО кнопку (второй эффект, CSS-переход ширины) — попап при этом НЕ
 * пересоздаётся. Прежняя версия пересобирала попап на смену CTA: старый удалялся
 * мгновенно, новый проявлялся с нуля — отсюда «пропал и появился». Теперь этого
 * нет: `onAction` в редакторе передаётся ВСЕГДА (кнопка есть у любого бейджа,
 * просто свёрнута), поэтому клик по маркеру не меняет состав попапа.
 *
 * @param {{ current: any }} mapRef
 * @param {boolean} ready
 * @param {any} cityBadge
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCityBadge(mapRef, ready, cityBadge, { enabled = true } = {}) {
  const popupRef = useRef(/** @type {any} */ (null));
  // Свежесть колбэка CTA держим в ref: новое замыкание родителя не пересобирает попап.
  const actionRef = useRef(/** @type {any} */ (cityBadge?.onAction));
  actionRef.current = cityBadge?.onAction;
  // Есть ли у бейджа кнопка вообще (редактор передаёт onAction всегда, планировщик
  // — никогда). Стабильно в рамках поверхности, поэтому попап по ней не дёргается.
  const hasButton = !!cityBadge?.onAction;
  const ctaOn = !!cityBadge?.ctaOn;

  // Жизненный цикл попапа — по ГОРОДУ (координаты/имя/даты/страна + hasButton), НЕ
  // по `ctaOn`. Смена CTA попап не трогает → без мигания.
  useEffect(() => {
    const map = mapRef.current;
    if (popupRef.current) { safeRemove(popupRef.current); popupRef.current = null; }
    if (!map || !ready || !enabled || !cityBadge || cityBadge.lng == null || cityBadge.lat == null) return undefined;
    const el = createCityBadgeEl(
      { countryCode: cityBadge.countryCode, name: cityBadge.name, dates: cityBadge.dates, actionLabel: cityBadge.actionLabel },
      { onAction: hasButton ? (e) => { const cb = actionRef.current; if (cb) cb(e); } : null },
    );
    popupRef.current = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false,
      className: 'cbadge-popup', offset: 16, maxWidth: 'none',
    })
      .setLngLat([cityBadge.lng, cityBadge.lat])
      .setDOMContent(el)
      .addTo(map);
    return () => { if (popupRef.current) { safeRemove(popupRef.current); popupRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, cityBadge?.lng, cityBadge?.lat, cityBadge?.name, cityBadge?.dates, cityBadge?.countryCode, hasButton]);

  // Раскрытие/сворачивание CTA ВНУТРИ живого попапа: город зафиксирован → кнопка
  // выезжает и попап расширяется; снят → кнопка сворачивается и попап сужается.
  // Механика — CSS-переход ширины по атрибуту `[data-on]` (см. `.cbadge__go` в
  // app.css). Зависит и от города: при переезде попапа на другой город (эффект
  // выше пересоздал кнопку) состояние надо восстановить на новой кнопке. rAF на
  // раскрытии — чтобы переход отрисовался и на ПЕРВОМ кадре свежего попапа.
  useEffect(() => {
    if (!ready) return undefined;
    const btn = popupRef.current?.getElement?.()?.querySelector?.('.cbadge__go');
    if (!btn) return undefined;
    let raf = 0;
    if (ctaOn) raf = requestAnimationFrame(() => { try { btn.dataset.on = '1'; } catch { /* ignore */ } });
    else { try { delete btn.dataset.on; } catch { /* ignore */ } }
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctaOn, cityBadge?.lng, cityBadge?.lat, cityBadge?.name, cityBadge?.dates, cityBadge?.countryCode, hasButton]);
}

export default useCityBadge;
