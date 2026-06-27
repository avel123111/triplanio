import React from 'react';

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
      <span
        style={{
          position: 'absolute',
          top: -8,
          right: 8,
          zIndex: 10,
          lineHeight: 1,
          pointerEvents: 'none',
          color: '#fff',
          background: 'var(--ai)',
          fontSize: '9.5px',
          fontWeight: 700,
          letterSpacing: '.08em',
          padding: '2px 5px',
          borderRadius: 4,
        }}
      >
        AI
      </span>
    </div>
  );
}
