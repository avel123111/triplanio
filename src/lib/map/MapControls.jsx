import React from 'react';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';

// On-map control buttons shared by every map surface: projection (flat ↔ globe),
// theme (day ↔ night) and start/finish visibility. Constant surface-coloured
// buttons (white in light theme, dark in dark theme) — only the icon changes per
// state. State lives in the parent; this is presentation only.
export default function MapControls({ projection, onToggleProjection, scheme, onToggleScheme, showSE, onToggleSE }) {
  const t = useT();
  const buttons = [
    { key: 'proj', title: projection === 'globe' ? t('tse.map_flat') : t('tse.map_globe'), icon: projection === 'globe' ? 'map' : 'globe', onClick: onToggleProjection },
    { key: 'theme', title: scheme === 'DARK' ? t('tse.map_light') : t('tse.map_dark'), icon: scheme === 'DARK' ? 'sun' : 'moon', onClick: onToggleScheme },
    { key: 'se', title: t('tse.map_startend'), icon: showSE ? 'flag' : 'eyeOff', onClick: onToggleSE },
  ];
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {buttons.map((b) => (
        <button key={b.key} type="button" onClick={b.onClick} title={b.title} aria-label={b.title}
          style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-soft)' }}>
          <Icon name={b.icon} size={17} />
        </button>
      ))}
    </div>
  );
}
