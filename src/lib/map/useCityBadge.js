// @ts-check
import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { createCityBadgeEl } from './markers';

// Снять попап, не падая, если его уже нет (двойной уход/размонтирование).
const safeRemove = (x) => { try { x.remove(); } catch { /* ignore */ } };

/**
 * Стеклянная плашка «флаг + город + даты» у активного города (линза «Маршрут»/
 * редактор и планировщик). Несётся `mapboxgl.Popup` без фиксированного `anchor`,
 * поэтому mapbox сам разворачивает её той стороной, что держит на экране (город у
 * края открывает внутрь). Эффект был построчной копией в `MapView` и `FlowMap` —
 * теперь один шов на обоих.
 *
 * `cityBadge` — `{ lng, lat, countryCode, name, dates, actionLabel?, onAction? } |
 * null`. `null` (и режим hotel-pick у редактора через `enabled=false`) снимает
 * плашку. `onAction` (+ `actionLabel`) добавляет бейджу CTA-шеврон «открыть город»
 * (двухшаговый клик в редакторе); без него плашка — пассивная метка.
 *
 * @param {{ current: any }} mapRef
 * @param {boolean} ready
 * @param {any} cityBadge
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCityBadge(mapRef, ready, cityBadge, { enabled = true } = {}) {
  const popupRef = useRef(/** @type {any} */ (null));
  // Попапы, доигрывающие анимацию ухода перед снятием. Нужны, чтобы на
  // размонтировании (инстанс карты ОБЩИЙ и переживёт экран) снести их мгновенно
  // и не дать «зависшему» бейджу мигнуть на следующем экране.
  const leavingRef = useRef(/** @type {Set<any>} */ (new Set()));
  // Свежесть колбэка CTA держим в ref: новое замыкание родителя не должно
  // пересобирать попап. Пересборка идёт только при смене НАЛИЧИЯ действия
  // (`hasAction`) — тогда кнопка появляется/исчезает.
  const actionRef = useRef(/** @type {any} */ (cityBadge?.onAction));
  actionRef.current = cityBadge?.onAction;
  const hasAction = !!cityBadge?.onAction;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !enabled || !cityBadge || cityBadge.lng == null || cityBadge.lat == null) return undefined;
    const el = createCityBadgeEl(
      { countryCode: cityBadge.countryCode, name: cityBadge.name, dates: cityBadge.dates, actionLabel: cityBadge.actionLabel },
      { onAction: hasAction ? (e) => { const cb = actionRef.current; if (cb) cb(e); } : null },
    );
    const popup = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false,
      className: 'cbadge-popup', offset: 16, maxWidth: 'none',
    })
      .setLngLat([cityBadge.lng, cityBadge.lat])
      .setDOMContent(el)
      .addTo(map);
    popupRef.current = popup;
    // ★ Анимируем ВЕСЬ бейдж (`el` = `.cbadge`), а не только кнопку: иначе кнопка
    // плывёт, а текст бейджа прыгает — тот самый рывок. Быстрый лёгкий рост при
    // появлении и сужение при уходе (opacity + scale). ТОЛЬКО у бейджа с CTA (клик
    // по маркеру в редакторе); пассивные метки — ховер и планировщик — появляются
    // и снимаются мгновенно, как раньше. Transform на ВНУТРЕННЕМ `el` не спорит с
    // позиционным transform mapbox (тот на внешней обёртке попапа).
    const animated = hasAction && !!el.animate;
    if (animated) {
      el.animate(
        [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    }
    return () => {
      popupRef.current = null;
      if (animated) {
        const pend = leavingRef.current;
        pend.add(popup);
        const done = () => { pend.delete(popup); safeRemove(popup); };
        el.animate(
          [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }],
          { duration: 120, easing: 'cubic-bezier(.4,0,1,1)' },
        ).finished.then(done, done);
      } else {
        safeRemove(popup);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, cityBadge?.lng, cityBadge?.lat, cityBadge?.name, cityBadge?.dates, cityBadge?.countryCode, hasAction, cityBadge?.actionLabel]);

  // Размонтирование: слить доигрывающие уход попапы — мгновенно (общий инстанс
  // карты не должен унести фейдящийся бейдж на следующий экран). Текущий попап
  // сюда не попадает: cleanup основного эффекта объявлен раньше и всегда обнуляет
  // `popupRef` (сняв попап или отправив его в `leavingRef`) до этого прогона.
  useEffect(() => () => {
    leavingRef.current.forEach(safeRemove);
    leavingRef.current.clear();
  }, []);
}

export default useCityBadge;
