import React, { useRef, useState } from 'react';
import { transportInfo, ACTIVITY_ICON, SIMPLE_TRANSPORT_TYPES } from '@/lib/transport';
import { DateTime } from 'luxon';
import { applyDelta, snapMinutes, isInsideBounds } from '@/lib/calendar/dragEvents';

const EVENT_STYLES = {
  activity: { stripe: 'bg-violet-500' },
  transfer: { stripe: 'bg-blue-500' },
};

function iconFor(it) {
  if (it.kind === 'transfer') return transportInfo(it.transport_type).Icon;
  return ACTIVITY_ICON;
}

/**
 * A single positioned event on the week grid. Supports:
 *  - move (drag the body, in both X-day and Y-time axes)
 *  - resize from top edge (changes start)
 *  - resize from bottom edge (changes end)
 *
 * For events without an end_datetime, only move is allowed (no resize handles).
 *
 * Bounds: activities → parent city visit; transfers → trip range.
 * If a drop would violate bounds, the change is rejected and the block snaps back.
 */
export default function WeekEventBlock({
  item, top, height, dayWidth, hourHeight,
  canEdit, onClick, onCommit,
  boundsStartIso, boundsEndIso,
}) {
  const Icon = iconFor(item);
  const style = EVENT_STYLES[item.kind] || EVENT_STYLES.activity;
  const tz = item.timezone || 'UTC';

  // SIMPLE transports (walk / own_transport) have no end_datetime in many
  // cases - treat them as point events without resize.
  const hasEnd = !!item.end && !(item.kind === 'transfer' && SIMPLE_TRANSPORT_TYPES.has(item.transport_type) && !item.end);

  // Drag state (transient pixel offsets applied via inline style during gesture).
  const [drag, setDrag] = useState(null); // { mode, dx, dy }
  const startRef = useRef(null);

  const beginGesture = (mode, e) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const originalStart = DateTime.fromISO(item.start, { zone: 'utc' }).setZone(tz);
    const originalEnd = item.end ? DateTime.fromISO(item.end, { zone: 'utc' }).setZone(tz) : null;
    startRef.current = { mode, startX, startY, originalStart, originalEnd };
    setDrag({ mode, dx: 0, dy: 0 });

    const handleMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setDrag({ mode, dx, dy });
    };
    const handleUp = (ev) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      // Pixel → minutes / day offset
      const rawMinutes = (dy / hourHeight) * 60;
      const deltaMinutes = snapMinutes(rawMinutes);
      // Day shift only matters for 'move' (resize stays within the same column).
      const dayOffsetDays = mode === 'move' ? Math.round(dx / dayWidth) : 0;

      // If user barely moved → treat as a click.
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        setDrag(null);
        startRef.current = null;
        if (onClick) onClick(item);
        return;
      }

      const result = applyDelta({
        mode,
        originalStart,
        originalEnd,
        deltaMinutes,
        newDayOffsetDays: dayOffsetDays,
      });
      setDrag(null);
      startRef.current = null;
      if (!result) return; // invalid (e.g. negative duration)
      if (!isInsideBounds(result.start, result.end, boundsStartIso, boundsEndIso)) {
        // snap back: nothing to do, drag state is already cleared
        return;
      }
      if (onCommit) onCommit(item, result);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  // While dragging, apply transient pixel offset so the user sees movement.
  let transform = '';
  if (drag) {
    if (drag.mode === 'move') transform = `translate(${drag.dx}px, ${drag.dy}px)`;
    // resize-top/bottom: visual feedback via top/height adjustment below
  }
  let blockTop = top;
  let blockHeight = height;
  if (drag?.mode === 'resize-top') {
    blockTop = top + drag.dy;
    blockHeight = Math.max(20, height - drag.dy);
  }
  if (drag?.mode === 'resize-bottom') {
    blockHeight = Math.max(20, height + drag.dy);
  }

  return (
    <div
      className="absolute left-1 right-1 rounded bg-card border border-border shadow-sm overflow-hidden select-none"
      style={{
        top: blockTop,
        height: blockHeight,
        transform,
        cursor: canEdit ? 'grab' : 'pointer',
        zIndex: drag ? 30 : 10,
      }}
      onPointerDown={(e) => {
        // Click without drag → handled inside handleUp (delta < 4px branch)
        beginGesture('move', e);
      }}
    >
      {/* Top resize handle */}
      {canEdit && hasEnd && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-foreground/10"
          onPointerDown={(e) => beginGesture('resize-top', e)}
        />
      )}
      {/* Bottom resize handle */}
      {canEdit && hasEnd && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-foreground/10"
          onPointerDown={(e) => beginGesture('resize-bottom', e)}
        />
      )}

      <div className={`${style.stripe} absolute left-0 top-0 bottom-0 w-1`} />

      <div className="pl-2 pr-1 py-1 flex items-start gap-1.5 min-w-0 w-full text-[11px] text-left">
        <Icon className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate text-foreground">{item.label}</div>
          <div className="text-[10px] text-muted-foreground">
            {DateTime.fromISO(item.start, { zone: 'utc' }).setZone(tz).toFormat('HH:mm')}
            {item.end && ` - ${DateTime.fromISO(item.end, { zone: 'utc' }).setZone(tz).toFormat('HH:mm')}`}
          </div>
        </div>
      </div>
    </div>
  );
}