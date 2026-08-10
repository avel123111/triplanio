import React from 'react';
import { IconBtn } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

// On-map control buttons shared by every map surface: projection (flat ↔ globe),
// theme (day ↔ night) and start/finish visibility. Only the icon changes per
// state; state lives in the parent, this is presentation only.
//
// ★TRIP-344: тот же объект, что `.map-ctl` на /stats — плашка `.map-ctl` несёт
// фон и рамку, кнопки внутри quiet. Инлайн лишь ставит плашку в свой угол
// (справа, колонкой), а не в левый угол по умолчанию.
export default function MapControls({ projection, onToggleProjection, scheme, onToggleScheme, showSE, onToggleSE }) {
  const t = useT();
  // ★TRIP-344 (канонизация состояния): у кнопок ПОЯВИЛСЯ индикатор «включено»
  // через `aria-pressed` — раньше состояния не было вовсе (только смена иконки),
  // теперь активное = канон `.icon-btn[aria-pressed]` (бренд-заливка). Семантика
  // «нажато» та же, что у карт-тогглов `ShareMapPreview`: globe / LIGHT / показ SE.
  const buttons = [
    { key: 'proj', title: projection === 'globe' ? t('tse.map_flat') : t('tse.map_globe'), icon: projection === 'globe' ? 'map' : 'globe', onClick: onToggleProjection, on: projection === 'globe' },
    { key: 'theme', title: scheme === 'DARK' ? t('tse.map_light') : t('tse.map_dark'), icon: scheme === 'DARK' ? 'sun' : 'moon', onClick: onToggleScheme, on: scheme === 'LIGHT' },
    { key: 'se', title: t('tse.map_startend'), icon: showSE ? 'flag' : 'eyeOff', onClick: onToggleSE, on: showSE },
  ];
  return (
    <div className="map-ctl" style={{ left: 'auto', right: 12, top: 12, zIndex: 6, flexDirection: 'column' }}>
      {buttons.map((b) => (
        <IconBtn key={b.key} icon={b.icon} onClick={b.onClick} title={b.title} ariaLabel={b.title}
          ariaPressed={b.on} size="sm" />
      ))}
    </div>
  );
}
