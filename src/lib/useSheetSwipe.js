import { useRef } from 'react';

/**
 * Drag-to-dismiss for bottom sheets (native-app feel).
 *
 * Attach `gripProps` to the grip ("бровь") element and `elRef` to the sheet
 * surface. Dragging the grip down translates the sheet; releasing past the
 * threshold calls `onDismiss`, otherwise it springs back. Touch-only (mobile).
 *
 *   const { elRef, gripProps } = useSheetSwipe(() => onOpenChange(false));
 *   <Content ref={elRef}><div className="grip" {...gripProps} />…</Content>
 */
export function useSheetSwipe(onDismiss, { threshold = 90, topZone = 0 } = {}) {
  const elRef = useRef(null);
  const startY = useRef(null);
  const dy = useRef(0);
  const dragging = useRef(false);

  const move = (y) => { const el = elRef.current; if (el) el.style.transform = y ? `translateY(${y}px)` : ''; };

  const onTouchStart = (e) => {
    const el = elRef.current;
    // When topZone is set, only start a drag from the grip area near the top of
    // the sheet — so dragging the body scrolls instead of dismissing.
    if (topZone > 0 && el) {
      const top = el.getBoundingClientRect().top;
      if (e.touches[0].clientY - top > topZone) { dragging.current = false; return; }
    }
    startY.current = e.touches[0].clientY;
    dy.current = 0;
    dragging.current = true;
    if (el) el.style.transition = 'none';
  };
  const onTouchMove = (e) => {
    if (!dragging.current || startY.current == null) return;
    const d = e.touches[0].clientY - startY.current;
    if (d > 0) { dy.current = d; move(d); }            // only downward
  };
  const onTouchEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const el = elRef.current;
    const d = dy.current;
    startY.current = null;
    if (el) el.style.transition = 'transform .24s cubic-bezier(.22,1,.36,1)';
    if (d > threshold) { move(window.innerHeight); onDismiss?.(); }
    else { move(0); }
  };

  return { elRef, gripProps: { onTouchStart, onTouchMove, onTouchEnd } };
}
