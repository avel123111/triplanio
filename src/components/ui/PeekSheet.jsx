import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PeekSheet — the NON-modal, persistent bottom-sheet archetype: it's always on
 * screen at a `peek` height and raises/lowers to `full`, the content underneath
 * stays live, and it never dismisses. This is the web equivalent of the native
 * detent sheet (iOS `UISheetPresentationController` detents / Android
 * `BottomSheetBehavior`).
 *
 * Deliberately NOT built on vaul: vaul is a *modal drawer* engine (open over a
 * backdrop → swipe to dismiss; it locks the page and sets touch-action:none on
 * the whole surface) — great for the canonical <Sheet>, but it fights the
 * always-on peek (broken inner scroll + the page pull-to-refresh on drag). So
 * this owns a small, native-style gesture instead:
 *   • the grip + header are drag zones; dragging moves peek ↔ full;
 *   • the body scrolls natively;
 *   • when expanded and the body is scrolled, the body scrolls; a downward drag
 *     from the top of the body hands back to collapsing the sheet (the native
 *     scroll↔drag handoff);
 *   • drags call preventDefault, and overscroll-behavior is contained, so the
 *     page never pull-to-refreshes.
 *
 * Controlled: `expanded` + `onExpandedChange`. The peek height is measured from
 * the grip + header (plus the fixed bottom-nav dock it sits behind + the home
 * safe-area), so callers don't pass magic pixels. Mobile only — desktop callers
 * render their own layout.
 *
 *   <PeekSheet expanded={open} onExpandedChange={setOpen} header={<Head/>} label="Route">
 *     <ScrollableList/>
 *   </PeekSheet>
 */

const DOCK_PX = 60; // the fixed bottom-nav dock the peek sits behind (TRIP-222)
const FLICK_VELOCITY = 0.3; // px/ms at release above which a flick snaps by direction

// Resolve the home-indicator inset in px (env() can't be read directly in JS).
function safeAreaBottom() {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height || 0;
  probe.remove();
  return h;
}

export function PeekSheet({ header, children, expanded, onExpandedChange, label }) {
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const bodyRef = useRef(null);
  const drag = useRef(null);
  const [peekPx, setPeekPx] = useState(140);
  const [dragOffset, setDragOffset] = useState(null); // px while the finger is down, else null

  // Latest props for the once-bound native listeners (so they never go stale
  // without re-binding on every render).
  const live = useRef();
  live.current = { expanded, onExpandedChange, peekPx };

  // Peek band = grip + header, plus the dock zone the sheet spans behind and the
  // safe-area, so the grip + title clear the dock.
  const measure = useCallback(() => {
    const sheet = sheetRef.current, head = headRef.current;
    if (!sheet || !head) return;
    const content = head.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
    setPeekPx(Math.round(content + DOCK_PX + safeAreaBottom()));
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && headRef.current) ro.observe(headRef.current);
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);

  // Native, non-passive touch handling — bound once; reads current state via
  // `live`. preventDefault on a drag is what stops the page pull-to-refresh.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    const opts = { passive: false };

    const onStart = (e) => {
      if (e.touches.length !== 1) { drag.current = null; return; }
      const fullH = el.getBoundingClientRect().height;
      const { expanded: exp, peekPx: pk } = live.current;
      const peekOffset = Math.max(0, fullH - pk);
      const base = exp ? 0 : peekOffset;
      drag.current = {
        startY: e.touches[0].clientY,
        base, peekOffset, last: base,
        lastY: e.touches[0].clientY, lastT: e.timeStamp, vy: 0, // for velocity/flick
        onGrip: !!(e.target.closest && e.target.closest('[data-peek-grip]')),
        mode: 'idle',
      };
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const y = e.touches[0].clientY;
      const dy = y - d.startY; // + down, − up
      if (d.mode === 'idle') {
        if (Math.abs(dy) < 4) return; // wait for intent
        const atTop = !bodyRef.current || bodyRef.current.scrollTop <= 0;
        // Expanded: only a downward drag from the top collapses; otherwise the
        // body scrolls natively. Peek: any drag moves the sheet.
        d.mode = (!live.current.expanded || (dy > 0 && atTop)) ? 'drag' : 'scroll';
      }
      if (d.mode !== 'drag') return;
      e.preventDefault();
      // Track finger velocity (px/ms, + = downward) from the last sample so a
      // quick flick snaps even over a short distance.
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.vy = (y - d.lastY) / dt;
      d.lastY = y; d.lastT = e.timeStamp;
      const offset = Math.max(0, Math.min(d.peekOffset, d.base + dy));
      d.last = offset;
      setDragOffset(offset);
    };
    const onEnd = (e) => {
      const d = drag.current; drag.current = null;
      if (!d) return;
      const { expanded: exp, onExpandedChange: cb } = live.current;
      if (d.mode === 'drag') {
        setDragOffset(null);
        // Ignore a stale velocity if the finger paused before lifting (>80ms
        // since the last move) — that's a deliberate placement, not a flick.
        const vy = (e.timeStamp - d.lastT) < 80 ? d.vy : 0;
        // A real flick commits in its direction over any distance (responsive);
        // a slow/paused drag settles to whichever detent is closer.
        const next = Math.abs(vy) > FLICK_VELOCITY
          ? vy < 0            // flick up → expand, flick down → collapse
          : d.last < d.peekOffset / 2; // → nearer detent
        if (next !== exp) cb && cb(next);
      } else if (d.mode === 'idle' && d.onGrip) {
        e.preventDefault(); // swallow the emulated click, then toggle
        cb && cb(!exp);
      }
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
  }, []);

  const onGripKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpandedChange && onExpandedChange(!expanded); }
  };

  const style = { '--peek': peekPx + 'px' };
  if (dragOffset != null) style.transform = `translateY(${dragOffset}px)`;

  if (typeof document === 'undefined') return null;
  // Portal to <body> so `position:fixed` anchors to the viewport (not an ancestor
  // with a transform/filter) and the sheet shares the dock's stacking context.
  return createPortal(
    <div
      ref={sheetRef}
      className={'peek-sheet' + (expanded ? ' is-expanded' : '') + (dragOffset != null ? ' is-dragging' : '')}
      style={style}
    >
      <div
        className="peek-sheet__grip"
        data-peek-grip
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={!!expanded}
        onKeyDown={onGripKey}
      >
        <i />
      </div>
      <div ref={headRef} className="peek-sheet__head">{header}</div>
      <div ref={bodyRef} className="peek-sheet__body">{children}</div>
    </div>,
    document.body,
  );
}

export default PeekSheet;
