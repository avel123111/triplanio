import React from 'react';

/**
 * The "AI" marker itself, pinned to the top-right of the nearest positioned
 * ancestor. Normally comes with `AiField`; exported separately for the one
 * layout that has to pin it further out than the tinted field (DateRangeBlock,
 * which explains why) - one badge, one implementation.
 */
export function AiBadge() {
  return (
    <span
      className="t-micro"
      style={{
        position: 'absolute',
        top: -8,
        right: 8,
        zIndex: 10,
        pointerEvents: 'none',
        color: '#fff',
        background: 'var(--ai)',
        padding: '2px 5px',
        borderRadius: 4,
      }}
    >
      AI
    </span>
  );
}

/**
 * Wraps a form field. When `active` (AI just filled it), the inner input gets a
 * violet tint via the `.ai-filled` CSS (see index.css) and a small "AI" badge is
 * pinned to the top-right of the field - matching the designer's `field--ai`
 * look (var(--ai) badge, var(--ai-soft) input fill).
 */
export default function AiField({ active, children, className = '' }) {
  if (!active) return <div className={className}>{children}</div>;
  return (
    <div className={`ai-filled ${className}`} style={{ position: 'relative' }}>
      {children}
      <AiBadge />
    </div>
  );
}
