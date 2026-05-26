import React from 'react';
import TripShell from './TripShell';

// Skeleton primitives + a full-page skeleton that mirrors the real TripView
// layout (same outer grid, same header/title/tabs slots).
// Used both for the initial blank state AND for the per-section "data still
// arriving" placeholders so the page never jumps as data streams in.
// Purely visual — no i18n strings needed.

function Bar({ className = '' }) {
  return <div className={`bg-muted/60 rounded-md animate-pulse ${className}`} />;
}

function CardBlock({ heightClass = 'h-24' }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-4 ${heightClass}`}>
      <div className="space-y-2">
        <Bar className="h-3 w-1/3" />
        <Bar className="h-3 w-2/3" />
        <Bar className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// Inline skeleton shown in the timeline area while `content` is still loading.
export function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      <CardBlock heightClass="h-32" />
      <CardBlock heightClass="h-24" />
      <CardBlock heightClass="h-32" />
      <CardBlock heightClass="h-24" />
    </div>
  );
}

// Skeleton for the body of a single sidebar collapsible card.
export function SidebarCardSkeleton({ rows = 2 }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <Bar key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

/**
 * Full-page skeleton that mirrors TripShell layout:
 * - TripShell adds `lg:pl-60` for the side menu
 * - Inside: px-4 sm:px-6 lg:px-8 py-6 sm:py-8
 * So the skeleton renders with the same padding, inside the same TripShell wrapper.
 */
export default function TripViewSkeleton({ tripId } = {}) {
  const inner = (
      <>
      {/* Title row + action buttons */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <Bar className="h-9 w-3/4 mb-2" />
          <Bar className="h-4 w-1/2" />
        </div>
        <div className="flex items-center gap-2">
          <Bar className="h-11 w-24 rounded-lg" />
          <Bar className="h-11 w-11 rounded-lg" />
          <Bar className="h-11 w-11 rounded-lg" />
        </div>
      </div>

      {/* Tabs bar */}
      <div className="mb-5 border-b border-border">
        <div className="flex gap-6 pb-2.5">
          <Bar className="h-4 w-16" />
          <Bar className="h-4 w-16" />
          <Bar className="h-4 w-20" />
          <Bar className="h-4 w-16" />
        </div>
      </div>

      {/* Two-column grid — mirrors timeline tab layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <main className="min-w-0">
          <TimelineSkeleton />
        </main>

        {/* Sidebar — 4 collapsibles */}
        <aside className="space-y-4 self-start">
          <CardBlock heightClass="h-28" />
          <CardBlock heightClass="h-24" />
          <CardBlock heightClass="h-24" />
          <CardBlock heightClass="h-28" />
        </aside>
      </div>
      </>
  );

  if (tripId) {
    return (
      <TripShell tripId={tripId} trip={null} access={null}>
        {inner}
      </TripShell>
    );
  }

  return (
    <div className="lg:pl-60">
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {inner}
      </div>
    </div>
  );
}