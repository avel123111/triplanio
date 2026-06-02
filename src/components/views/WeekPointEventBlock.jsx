import React from 'react';
import { DateTime } from 'luxon';
import { BedDouble, Car, CalendarX } from 'lucide-react';

/**
 * Static (non-draggable) 1-hour block on the week grid for "point" events
 * that have no end_datetime - hotel check-in/out, hotel free-cancellation
 * deadline, car rental pickup/drop-off.
 *
 * Clicking the block opens the parent entity's view dialog (handled by the
 * caller via onClick).
 */
function pointIcon(kind) {
  if (kind === 'car_pickup' || kind === 'car_dropoff') return Car;
  if (kind === 'hotel_cancel_deadline') return CalendarX;
  return BedDouble;
}

export default function WeekPointEventBlock({ item, top, height, style, onClick }) {
  const Icon = pointIcon(item.kind);
  const tz = item.timezone || 'UTC';
  const time = DateTime.fromISO(item.start, { zone: 'utc' }).setZone(tz).toFormat('HH:mm');
  return (
    <button
      type="button"
      onClick={() => onClick && onClick(item)}
      className={`absolute left-1 right-1 rounded border border-border shadow-sm overflow-hidden text-left ${style.card} hover:opacity-90`}
      style={{ top, height, zIndex: 8 }}
      title={item.label}
    >
      <div className={`${style.stripe} absolute left-0 top-0 bottom-0 w-1`} />
      <div className="pl-2 pr-1 py-1 flex items-start gap-1.5 text-[11px]">
        <Icon className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{item.label}</div>
          <div className="text-[10px] opacity-70">{time}</div>
        </div>
      </div>
    </button>
  );
}