import React from 'react';

/**
 * Vertical dashed rail line for timeline layouts.
 * Spans the full height of its containing wrapper (which must be position:relative).
 * The wrapper's first column is expected to be w-12 (48px) - the rail is rendered
 * at left-6 (24px) which is the column's horizontal center.
 *
 * Implemented as a 1px-wide element with a vertical repeating dashed gradient
 * (border-dashed on a 1px box is not rendered consistently across browsers).
 *
 * Note: props `containerRef` and `deps` are accepted for backwards compatibility
 * with previous callers, but are not used.
 */
export default function TimelineRail() {
  return (
    <div
      aria-hidden
      // top/bottom are inset by 20px (= half of the 40px round anchor) so the
      // dashed rail starts exactly at the center of the first anchor circle
      // and ends at the center of the last one - never overshooting above the
      // "start" point or below the "end" point.
      className="absolute left-[19px] top-5 bottom-5 w-0.5"
      style={{
        backgroundImage:
          'linear-gradient(to bottom, hsl(var(--muted-foreground) / 0.55) 50%, transparent 50%)',
        backgroundSize: '2px 8px',
        backgroundRepeat: 'repeat-y',
      }}
    />
  );
}