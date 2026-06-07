import React from 'react';
import { Icon } from '@/design/icons';

// ─── Global trip header (the gradient "hero", .thead in the Lumo V3 mockup) ──
//
// Rendered ONCE by the trip shell (TripView / TripStructureEdit) between the
// top brand bar and the body, so it stays put when switching lenses. Purely
// presentational chrome: the cover (uploaded photo → preset gradient → default
// waves), the trip title + subtitle, a mobile menu button on the left, and a
// right-hand `actions` slot. The owning screen decides what goes in `actions`
// (TripView → Share / Edit / "…"; the editor → Save / Exit), so every dialog
// opened from here is wired by that screen and works on every lens.
//
// Buttons placed in `actions` should use `trip-hero__btn` (white-on-gradient);
// wrap their label in `<span className="trip-hero__btn-text">` so it collapses
// to an icon on mobile.

export default function TripHeaderBar({
  title,
  subtitle,
  coverImageUrl,
  coverGradientCss,
  useDefaultWaves = false,
  onMenu,
  actions,
}) {
  const bg = coverImageUrl
    ? undefined
    : coverGradientCss
      ? coverGradientCss
      : 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)';

  return (
    <div className="trip-hero">
      <div className="trip-hero__bg" style={bg ? { background: bg } : undefined}>
        {coverImageUrl && <img src={coverImageUrl} alt="" />}
        {useDefaultWaves && !coverImageUrl && (
          <svg viewBox="0 0 800 120" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
            <path d="M0 78 Q 200 48 400 66 T 800 57 L 800 120 L 0 120 Z" fill="rgba(255,255,255,.5)" />
            <path d="M0 96 Q 250 66 450 84 T 800 78 L 800 120 L 0 120 Z" fill="rgba(255,255,255,.3)" />
            <circle cx="690" cy="30" r="18" fill="rgba(255,255,255,.6)" />
          </svg>
        )}
      </div>
      <div className="trip-hero__ov" />
      <div className="trip-hero__in">
        {onMenu && (
          <button className="trip-hero__menu" onClick={onMenu} aria-label="Menu">
            <Icon name="list" size={19} />
          </button>
        )}
        <div className="trip-hero__title">
          <h2>{title || '…'}</h2>
          {subtitle && <div className="trip-hero__sub">{subtitle}</div>}
        </div>
        <div className="trip-hero__sp" />
        {actions && <div className="trip-hero__actions">{actions}</div>}
      </div>
    </div>
  );
}
