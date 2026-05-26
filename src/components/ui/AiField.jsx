import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Wraps a form field. When `active` is true (AI just filled it),
 * renders an animated gradient ring + tiny corner sparkle badge,
 * plus a light primary tint on inputs inside.
 */
export default function AiField({ active, children, className = '' }) {
  if (!active) return <div className={className}>{children}</div>;
  return (
    <div className={`relative rounded-lg p-[2px] ai-shimmer ai-filled ${className}`}>
      <div className="rounded-md bg-primary/5">
        {children}
      </div>
      <span className="absolute -top-1.5 -right-1.5 z-10 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-primary via-chart-2 to-accent shadow ring-2 ring-background">
        <Sparkles className="w-2.5 h-2.5 text-white" />
      </span>
    </div>
  );
}