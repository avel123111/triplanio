import React from 'react';

// Skeleton placeholders for the Trips list page.
// Mirrors the two layouts (grid → TripCard, list → TripListRow) so the
// transition from skeleton to real content doesn't cause layout shift.

function Bar({ className = '' }) {
  return <div className={`bg-muted/60 rounded-md animate-pulse ${className}`} />;
}

function GridCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card">
      {/* Cover image area (matches TripCard's aspect-[16/10]) */}
      <div className="relative aspect-[16/10] bg-muted/40 animate-pulse" />
      {/* Footer row with date + city count */}
      <div className="p-4 flex items-center justify-between">
        <Bar className="h-3 w-24" />
        <Bar className="h-3 w-16" />
      </div>
    </div>
  );
}

function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-3 rounded-2xl border border-border bg-card">
      {/* Thumbnail */}
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-muted/40 animate-pulse shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Bar className="h-4 w-2/3" />
        <div className="flex gap-3">
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

export default function TripListSkeleton({ viewMode = 'list', count = 4 }) {
  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <GridCardSkeleton key={i} />
      ))}
    </div>
  );
}