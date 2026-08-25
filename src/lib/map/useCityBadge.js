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
    // Уход: есть CTA → доигрываем её лёгкое исчезновение, потом снимаем попап;
    // иначе (пассивная метка / планировщик) снимаем сразу — там поведение прежнее.
    return () => {
      popupRef.current = null;
      const go = popup.getElement?.()?.querySelector?.('.cbadge__go');
      if (go && go.animate) {
        const pend = leavingRef.current;
        pend.add(popup);
        const done = () => { pend.delete(popup); safeRemove(popup); };
        go.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)' }], { duration: 130, easing: 'ease-in' })
          .finished.then(done, done);
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
