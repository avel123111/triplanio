// @ts-check
// Драг-высота мобильного шита канвас-раскладки (планер + редактор трипа).
// Палец на грабере тянет НИЖНЮЮ панель между min% и max% высоты канваса —
// значение едет CSS-переменной `--sheet-h` на хосте (.flow-grid), раскладку
// читает медиа-блок ≤760 flow-семьи. Карта над шитом подстраивается сама:
// её контейнер меняет высоту, а useMapSurface держит ResizeObserver →
// map.resize() (тот же механизм, что на десктопном ресайзе).
//
// Реализация без React-стейта НАМЕРЕННО: во время жеста меняется только
// style-переменная хоста (ноль ре-рендеров редактора/планера на каждый
// pointermove); процент не персистится — новый вход = дефолт из CSS.
import { useCallback } from 'react';

export function useSheetDrag(hostRef, { min = 10, max = 100 } = {}) {
  const onPointerDown = useCallback((e) => {
    const host = hostRef.current;
    if (!host) return;
    e.preventDefault();
    const grip = e.currentTarget;
    try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const rect = host.getBoundingClientRect();
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const apply = (clientY) => {
      const pct = clamp(((rect.bottom - clientY) / rect.height) * 100);
      host.style.setProperty('--sheet-h', `${pct}%`);
    };
    apply(e.clientY);
    const onMove = (ev) => apply(ev.clientY);
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }, [hostRef, min, max]);

  return { onPointerDown };
}
