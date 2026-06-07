import React from 'react';
import { Icon } from '@/design/icons';

// Canonical Pro badge — gold gradient via .badge--pro (single token source: --pro*).
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
      className={`badge badge--pro ${className}`.trim()}
      style={{ gap: 4, fontWeight: 700, fontSize: s.fontSize, padding: s.padding, lineHeight: 1.2 }}
    >
      <Icon name="pro" size={s.icon} /> Pro
    </span>
  );
}
