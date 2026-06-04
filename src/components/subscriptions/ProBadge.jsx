import React from 'react';
import { Icon } from '@/design/icons';

// Canonical Pro badge — warm token treatment (matches <Badge variant="warm" icon="pro">).
// Keeps the { className, size } API so existing callers (TripCard/Grid/ListRow) are unchanged.
const SIZES = {
  sm: { fontSize: 'var(--fs-micro)', padding: '2px 7px', icon: 11 },
  md: { fontSize: 'var(--fs-meta)', padding: '2px 9px', icon: 12 },
  lg: { fontSize: 'var(--fs-base)', padding: '3px 11px', icon: 13 },
};

export default function ProBadge({ className = '', size = 'md' }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600,
        borderRadius: 999, background: 'var(--warm-tint)', color: 'var(--warm)',
        fontSize: s.fontSize, padding: s.padding, lineHeight: 1.2,
      }}
    >
      <Icon name="pro" size={s.icon} /> Pro
    </span>
  );
}
