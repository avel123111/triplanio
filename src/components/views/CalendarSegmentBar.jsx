import React from 'react';

/**
 * A single horizontal bar inside a calendar cell, split into equal segments.
 * Each segment is colored by its own class and shows a label (truncated).
 *
 * Props:
 *  - segments: array of { key, label, colorClass, raw? }
 *  - height: px (default 18)
 *  - onSegmentClick: optional (segment) => void - makes each segment a button
 */
export default function CalendarSegmentBar({ segments, height = 18, onSegmentClick }) {
  if (!segments || segments.length === 0) return <div style={{ height }} />;
  return (
    <div className="flex gap-px overflow-hidden rounded" style={{ height }}>
      {segments.map((seg, i) => {
        const baseClass = `${seg.colorClass} flex-1 min-w-0 px-1.5 flex items-center text-[10px] font-medium truncate`;
        const content = <span className="truncate">{seg.label}</span>;
        if (onSegmentClick) {
          return (
            <button
              key={`${seg.key}-${i}`}
              type="button"
              onClick={(e) => { e.stopPropagation(); onSegmentClick(seg); }}
              className={`${baseClass} hover:opacity-90 text-left`}
              title={seg.label}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={`${seg.key}-${i}`}
            className={baseClass}
            title={seg.label}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}