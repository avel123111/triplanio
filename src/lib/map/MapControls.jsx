import React from 'react';
import { IconBtn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// On-map control buttons shared by every map surface: projection (flat ↔ globe),
// theme (day ↔ night) and start/finish visibility. Constant surface-coloured
// buttons (white in light theme, dark in dark theme) — only the icon changes per
// state. State lives in the parent; this is presentation only.
//
// TRIP-344 PR 2: облик кнопки больше не пишется здесь руками (36×36 + рамка +
// фон + тень девятью объявлениями в `style`) — он приходит из <IconBtn>.
// `outline` (а не `quiet`) потому, что кнопка лежит ПОВЕРХ живой карты: у quiet
// фон и рамка прозрачные, и над картой она нечитаема. Тень при пересадке ушла —
// её нет и у канонического `.map-ctl button`. Инлайн остаётся ровно один и он
// про РАСКЛАДКУ плашки (позиция + колонка), а не про облик кнопки.
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
        <IconBtn key={b.key} icon={b.icon} onClick={b.onClick} title={b.title} ariaLabel={b.title}
          tone="outline" size="sm" />
      ))}
    </div>
  );
}
