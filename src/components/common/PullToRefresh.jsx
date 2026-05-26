import React, { useRef, useState, useCallback } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

/**
 * Mobile-only pull-to-refresh wrapper.
 *
 * Triggers `onRefresh` (returns a Promise) when the user pulls the page down
 * from the very top by more than THRESHOLD pixels. Designed to be lightweight
 * and additive — it only intercepts touch events when the page is at scrollTop=0
 * AND the gesture starts as a downward pull. Otherwise it lets the browser handle
 * normal scrolling.
 *
 * Note: on iOS Safari the native browser-level pull-to-refresh may also trigger.
 * That's accepted for now (user signed off).
 */
const THRESHOLD = 70;       // px before refresh fires
const MAX_PULL = 120;       // px visual cap on the indicator
const RESISTANCE = 0.5;     // dampen pull distance so it feels physical

export default function PullToRefresh({ onRefresh, children, disabled = false }) {
  const startY = useRef(null);
  const pullDistance = useRef(0);
  const [visualPull, setVisualPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const isAtTop = () =>
    (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  const onTouchStart = useCallback((e) => {
    if (disabled || refreshing) return;
    if (!isAtTop()) return;
    startY.current = e.touches[0].clientY;
    pullDistance.current = 0;
  }, [disabled, refreshing]);

  const onTouchMove = useCallback((e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    // Only react to downward pulls when still at top of page.
    if (dy <= 0 || !isAtTop()) {
      startY.current = null;
      setVisualPull(0);
      return;
    }
    const pulled = Math.min(MAX_PULL, dy * RESISTANCE);
    pullDistance.current = pulled;
    setVisualPull(pulled);
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (startY.current == null) return;
    const final = pullDistance.current;
    startY.current = null;
    pullDistance.current = 0;
    if (final >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setVisualPull(THRESHOLD);
      try {
        await onRefresh?.();
      } finally {
        setRefreshing(false);
        setVisualPull(0);
      }
    } else {
      setVisualPull(0);
    }
  }, [onRefresh, refreshing]);

  // Visual indicator — rotates the arrow as the user pulls past threshold
  // (when they release, it becomes a spinner).
  const indicatorOpacity = Math.min(1, visualPull / THRESHOLD);
  const indicatorRotate = Math.min(180, (visualPull / THRESHOLD) * 180);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Indicator — absolutely positioned so it doesn't push content layout
          when not active. Translates down only while pulling/refreshing. */}
      <div
        aria-hidden={visualPull === 0 && !refreshing}
        className="pointer-events-none flex justify-center transition-[height] duration-150"
        style={{
          height: visualPull,
          opacity: indicatorOpacity || (refreshing ? 1 : 0),
        }}
      >
        <div className="flex items-center justify-center w-9 h-9 mt-1 rounded-full bg-card border border-border shadow-sm">
          {refreshing ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          ) : (
            <ArrowDown
              className="w-4 h-4 text-muted-foreground transition-transform"
              style={{ transform: `rotate(${indicatorRotate}deg)` }}
            />
          )}
        </div>
      </div>

      {children}
    </div>
  );
}