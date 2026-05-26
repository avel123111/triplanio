import React from 'react';
import { TimelineSkeleton } from '@/components/trips/TripViewSkeleton';

// Skeleton tailored to the TripEdit page layout — a single-column layout
// with: back/view bar, hero header, then the timeline. No tabs and no
// sidebar, since the editor doesn't have them.

function Bar({ className = '' }) {
  return <div className={`bg-muted/60 rounded-md animate-pulse ${className}`} />;
}

export default function TripEditSkeleton() {
  return (
    <div>
      {/* Back link + "View" button row */}
      <div className="flex items-center justify-between mb-3">
        <Bar className="h-4 w-20" />
        <Bar className="h-8 w-20 rounded-md" />
      </div>

      {/* Hero header: title + meta line */}
      <div className="mb-6">
        <Bar className="h-9 w-2/3 mb-2" />
        <Bar className="h-4 w-1/3" />
      </div>

      <TimelineSkeleton />
    </div>
  );
}