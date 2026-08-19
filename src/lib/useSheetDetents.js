import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useKeyboardOpen } from '@/lib/keyboardOpen';

/**
 * useSheetDetents — a draggable, multi-detent bottom sheet controller for a sheet
 * whose HEIGHT (not transform) tracks the finger. The sheet element is expected to
 * be `position:absolute; bottom:0` inside a positioned parent, with its height read
 * from the `--sheet-h` custom property this hook writes.
 *
 * Why height and not translateY (as PeekSheet does): the planner sheet keeps a
 * pinned action footer at the viewport bottom and an internally-scrolling body, so
 * its bottom edge must stay at the viewport bottom at every detent — a translateY
 * would push the footer off-screen. The map behind is a SEPARATE full-bleed element
 * (never resized here), so shrinking the sheet only reveals more of the already-
 * rendered map — no Mapbox canvas resize thrash on drag.
 *
 * The gesture (velocity flick, scroll↔drag handoff, non-passive `preventDefault`
 * against pull-to-refresh) mirrors the proven PeekSheet implementation; kept local
 * for now because the two sheets differ in sizing model (translateY peek-default vs
 * height full-default) — a later pass can lift the shared gesture core out of both.
 *
 * Detents are fractions of the viewport height, ASCENDING (e.g. [0.22, 0.68, 1] =
 * peek / default / full). `initialIndex` picks the resting detent. While the soft
 * keyboard is up the sheet is forced to the tallest detent and drag is disabled, so
 * the focused field sits in one stable scroller above the keyboard (the map band is
 * fully covered → nothing left to reflow).
 *
 * Drag zones are elements carrying `[data-sheet-drag]` (the grip / header). The body
 * (`bodyRef`) scrolls natively; a downward drag from its top while fully expanded
 * hands back to collapsing the sheet.
 */

const FLICK_VELOCITY = 0.3; // px/ms at release above which a flick snaps by direction

function viewportH() {
  if (typeof window === 'undefined') return 800;
  return Math.round(window.visualViewport?.height || window.innerHeight || 800);
}

export function useSheetDetents({
  detents = [0.22, 0.68, 1],
  initialIndex = 1,
  enabled = true,
} = {}) {
  const rootRef = useRef(null);
  const bodyRef = useRef(null);
  const drag = useRef(null);

  const [index, setIndex] = useState(initialIndex);
  const [H, setH] = useState(viewportH);
  const [dragH, setDragH] = useState(null); // px while the finger is down, else null

  const keyboardOpen = useKeyboardOpen();
  // Restore the pre-keyboard detent once the keyboard closes.
  const prevIndexRef = useRef(index);
  useEffect(() => {
    if (!enabled) return;
    if (keyboardOpen) {
      prevIndexRef.current = index;
      setIndex(detents.length - 1); // force full while typing
    } else {
      setIndex(prevIndexRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardOpen, enabled]);

  const locked = keyboardOpen; // no drag while the keyboard drives the sheet

  // Track viewport height (visualViewport shrinks with the keyboard, so the full
  // detent fills the area ABOVE the keyboard).
  useLayoutEffect(() => {
    const onResize = () => setH(viewportH());
    onResize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  const minH = Math.round(detents[0] * H);
  const maxH = Math.round(detents[detents.length - 1] * H);
  const settledHeightPx = Math.round(detents[index] * H);
  const heightPx = dragH != null ? dragH : settledHeightPx;

  // Latest values for the once-bound native listeners.
  const live = useRef();
  live.current = { index, H, detents, minH, maxH, settledHeightPx, locked };

  const nearestIndex = useCallback((px) => {
    const { detents: ds, H: h } = live.current;
    let best = 0;
    let bestD = Infinity;
    ds.forEach((f, i) => {
      const d = Math.abs(f * h - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }, []);

  // Non-passive touch handling — bound once, reads current state via `live`.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !enabled) return undefined;
    const opts = { passive: false };

    const onStart = (e) => {
      if (live.current.locked || e.touches.length !== 1) { drag.current = null; return; }
      const base = live.current.settledHeightPx;
      drag.current = {
        startY: e.touches[0].clientY,
        base, last: base, startIndex: live.current.index,
        lastY: e.touches[0].clientY, lastT: e.timeStamp, vy: 0,
        onHandle: !!(e.target.closest && e.target.closest('[data-sheet-drag]')),
        mode: 'idle',
      };
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const y = e.touches[0].clientY;
      const dy = y - d.startY; // + down (shrink), − up (grow)
      if (d.mode === 'idle') {
        if (Math.abs(dy) < 4) return; // wait for intent
        const atTop = !bodyRef.current || bodyRef.current.scrollTop <= 0;
        const isFull = live.current.index === live.current.detents.length - 1;
        // Grip / header → drag (grow / shrink). Inside the body the content scrolls
        // natively; only a downward drag from the very top of a fully-expanded sheet
        // hands back to collapsing it (the native scroll↔drag handoff).
        d.mode = d.onHandle || (isFull && dy > 0 && atTop) ? 'drag' : 'scroll';
      }
      if (d.mode !== 'drag') return;
      e.preventDefault();
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vy = (y - d.lastY) / dt;
      d.lastY = y; d.lastT = e.timeStamp;
      const next = Math.max(live.current.minH, Math.min(live.current.maxH, d.base - dy));
      d.last = next;
      setDragH(next);
    };
    const onEnd = (e) => {
      const d = drag.current; drag.current = null;
      if (!d) return;
      if (d.mode !== 'drag') return;
      setDragH(null);
      // Ignore a stale velocity if the finger paused (>80ms) before lifting.
      const vy = (e.timeStamp - d.lastT) < 80 ? d.vy : 0;
      let idx;
      if (Math.abs(vy) > FLICK_VELOCITY) {
        // Flick: step one detent in the flick direction from where we started.
        const dir = vy < 0 ? 1 : -1; // up = grow (higher index), down = shrink
        idx = Math.max(0, Math.min(live.current.detents.length - 1, d.startIndex + dir));
      } else {
        idx = nearestIndex(d.last);
      }
      setIndex(idx);
    };

    el.addEventListener('touchstart', onStart, opts);
    el.addEventListener('touchmove', onMove, opts);
    el.addEventListener('touchend', onEnd, opts);
    el.addEventListener('touchcancel', onEnd, opts);
    return () => {
      el.removeEventListener('touchstart', onStart, opts);
      el.removeEventListener('touchmove', onMove, opts);
      el.removeEventListener('touchend', onEnd, opts);
      el.removeEventListener('touchcancel', onEnd, opts);
    };
  }, [enabled, nearestIndex]);

  return {
    rootRef,
    bodyRef,
    index,
    isDragging: dragH != null,
    isLow: index === 0,
    isFull: index === detents.length - 1,
    heightPx,
    settledHeightPx,
    // Inline style for the sheet root; `--sheet-h` drives its height in CSS.
    sheetStyle: enabled ? { '--sheet-h': heightPx + 'px' } : undefined,
  };
}

export default useSheetDetents;
