import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import HeaderActions from '@/components/HeaderActions';

/**
 * Unified top bar (brand gradient) used across the whole app.
 *
 * Replaces the old white `.app-header` AND the separate gradient hero
 * (`.trip-hero` / TripHeaderBar): both rows collapse into a single branded
 * bar. The trip title, meta and trip-action buttons now live here, separated
 * from the brand block and from the utility cluster by vertical dividers.
 *
 *   [menu*][back*] logo · Triplanio │ <trip title + meta> … <trip actions> │ theme · bell · account+PRO
 *     menu  — burger, shown ONLY on mobile (opens the trip sidebar drawer)
 *     back  — round back/exit button, rendered when `onBack` is provided
 *     trip  — title / meta / actions render only when a trip context is given
 *
 * Trip-action buttons passed via `actions` should use the `app-header__act`
 * class (add `app-header__act--icon` for icon-only) and wrap their label in
 * `<span className="app-header__act-text">` so it collapses to an icon on
 * mobile. PRO badge + utility icons come from <HeaderActions>.
 *
 * Props:
 *   user, isPro, isDark, onToggleTheme — forwarded to the right-hand cluster
 *   onBrand   — click handler for the logo/brand (defaults to nav('/trips'))
 *   onBack    — optional; renders the round back button when set
 *   backTitle — tooltip / aria-label for the back button
 *   onMenu    — optional; renders the mobile-only burger (trip sidebar)
 *   title     — optional trip title (enables the trip block)
 *   meta      — optional trip meta node (e.g. dates · days · cities)
 *   actions   — optional trip-action buttons node (Share / Edit / …)
 */
export default function AppHeader({
  user,
  isPro,
  isDark,
  onToggleTheme,
  onBrand,
  onBack,
  backTitle,
  onMenu,
  title,
  meta,
  actions,
  isTrip = false,
}) {
  const nav = useNavigate();
  const goBrand = onBrand || (() => nav('/trips'));
  const hasTrip = title != null || meta != null;

  return (
    <header className={'app-header' + (isTrip ? ' app-header--trip' : '')}>
      <div className="app-header__left">
        {onMenu && (
          <button className="app-header__gbtn app-header__menu" onClick={onMenu} aria-label="Menu" type="button">
            <Icon name="list" size={18} />
          </button>
        )}
        {onBack && (
          <button className="app-header__gbtn" onClick={onBack} title={backTitle} aria-label={backTitle || 'Back'} type="button">
            <Icon name="back" size={17} />
          </button>
        )}

        <div className="app-header__brand" onClick={goBrand}>
          <span className="app-header__logo">
            <img src="/triplanio-logo.svg" alt="Triplanio" />
          </span>
          <span className="app-header__brand-name">Triplanio</span>
        </div>

        {hasTrip && (
          <>
            <span className="app-header__vdiv" />
            <div className="app-header__trip">
              <h1 className="app-header__trip-title">{title || '…'}</h1>
              {meta && <div className="app-header__trip-meta">{meta}</div>}
            </div>
          </>
        )}
      </div>

      <div className="app-header__right">
        {actions && (
          <>
            <div className="app-header__trip-actions" role="group">{actions}</div>
            <span className="app-header__vdiv" />
          </>
        )}
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </header>
  );
}
