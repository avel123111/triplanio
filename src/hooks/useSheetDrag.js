// @ts-check
// Свайп-шит канвас-раскладки (планер / редактор / мобильные Обзор и Статистика).
// ТРИ снап-позиции: 10% (полоска), дефолт (68%), 100% (весь экран) — свайп по
// граберу переводит в соседнюю ступень по направлению жеста; во время жеста шит
// живьём следует за пальцем (--sheet-h на хосте), на отпускании доезжает до
// ступени CSS-транзишеном (класс is-snapping на хосте).
//
// КАРТА НЕ РЕСАЙЗИТСЯ: канвас карты всегда полной высоты позади шита (ресайз
// GL-канваса на каждый кадр и давал «карта пропадает и появляется»). Вместо
// этого камере едет НИЖНИЙ ОТСТУП (Mapbox padding): во время жеста —
// setPadding (мгновенно, без анимации), на снапе — easeTo (плавный доезд).
// Канал до карты — window-событие 'triplanio:sheet-inset'; его слушает
// useMapSurface (единый дом всех карт), поэтому планер (FlowMap), редактор
// (MapView-синглтон) и StatsMap получают поведение одной строкой.
//
// Реализация без React-стейта НАМЕРЕННО: жест пишет style-переменную хоста и
// шлёт события (ноль ре-рендеров экрана на pointermove); процент не
// персистится — новый вход = дефолт из CSS.
import { useCallback, useEffect, useRef } from 'react';

export const SHEET_INSET_EVENT = 'triplanio:sheet-inset';
const SNAPS = [10, 68, 100];
const DEFAULT_PCT = 68;
// Мобильный канвас (медиа-блок ≤760 flow-семьи) — единственный мир шита.
const MOBILE_MQ = '(max-width: 760px)';

const emitInset = (px, animate) => {
  window.dispatchEvent(new CustomEvent(SHEET_INSET_EVENT, { detail: { px, animate } }));
};

export function useSheetDrag(hostRef) {
  const pctRef = useRef(DEFAULT_PCT);

  // Пока канвас на экране (и вьюпорт мобильный) — камера карты держит нижний
  // отступ под текущий шит; уход с экрана/на десктоп возвращает ноль (карта —
  // синглтон, чужой padding не должен пережить экран).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => {
      const host = hostRef.current;
      if (mq.matches && host) emitInset(host.getBoundingClientRect().height * (pctRef.current / 100), true);
      else emitInset(0, false);
    };
    // Пара кадров — контейнер и карта успевают смонтироваться/измериться.
    const raf = requestAnimationFrame(() => requestAnimationFrame(sync));
    mq.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', sync);
      emitInset(0, false);
    };
  }, [hostRef]);

  const onPointerDown = useCallback((e) => {
    const host = hostRef.current;
    if (!host) return;
    e.preventDefault();
    const grip = e.currentTarget;
    try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = host.getBoundingClientRect();
    const startPct = pctRef.current;
    const startY = e.clientY;
    host.classList.remove('is-snapping');
    let raf = 0;
    const apply = (clientY) => {
      const pct = Math.min(100, Math.max(10, ((rect.bottom - clientY) / rect.height) * 100));
      pctRef.current = pct;
      host.style.setProperty('--sheet-h', `${pct}%`);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          emitInset(rect.height * (pctRef.current / 100), false);
        });
      }
    };
    const snap = (clientY) => {
      const movedPct = ((startY - clientY) / rect.height) * 100; // >0 = свайп вверх
      let target;
      if (Math.abs(movedPct) < 6) {
        // Короткое движение — вернуться на исходную ступень.
        target = SNAPS.reduce((a, b) => (Math.abs(b - startPct) < Math.abs(a - startPct) ? b : a));
      } else {
        // Направление жеста решает СОСЕДНЮЮ ступень от исходной.
        const fromIdx = SNAPS.reduce((ai, b, i) => (Math.abs(b - startPct) < Math.abs(SNAPS[ai] - startPct) ? i : ai), 0);
        const toIdx = Math.min(SNAPS.length - 1, Math.max(0, fromIdx + (movedPct > 0 ? 1 : -1)));
        target = SNAPS[toIdx];
      }
      pctRef.current = target;
      host.classList.add('is-snapping');
      host.style.setProperty('--sheet-h', `${target}%`);
      emitInset(rect.height * (target / 100), true);
      window.setTimeout(() => host.classList.remove('is-snapping'), 320);
    };
    const onMove = (ev) => apply(ev.clientY);
    const onUp = (ev) => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      snap(ev.clientY);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }, [hostRef]);

  return { onPointerDown };
}
