import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import HeaderActions from '@/components/HeaderActions';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Unified top bar (brand gradient) used across the whole app.
 *
 * Replaces the old white `.app-header` AND the separate gradient hero
 * (`.trip-hero` / TripHeaderBar): both rows collapse into a single branded
 * bar. The trip title, meta and trip-action buttons now live here, separated
 * from the brand block and from the utility cluster by vertical dividers.
 *
 *   [menu*][back*] logo · Triplanio │ <trip title + meta> │ theme · bell · account+PRO
 *     menu  — burger, shown ONLY on mobile (opens the trip sidebar drawer)
 *     back  — round back/exit button, rendered when `onBack` is provided
 *     trip  — title / meta render only when a trip context is given
 *
 * Trip actions (Share / Edit / Settings / Members / Copy) live in the left trip
 * menu (TripSidebar), NOT in this header. PRO badge + utility icons come from
 * <HeaderActions>.
 *
 * Props:
 *   user, isPro, isDark, onToggleTheme — forwarded to the right-hand cluster
 *   onBrand   — click handler for the logo/brand (defaults to nav('/trips'))
 *   onBack    — optional; renders the round back button when set
 *   backTitle — tooltip / aria-label for the back button
 *   onMenu    — optional; renders the mobile-only burger (trip sidebar)
 *   title     — optional trip title (enables the trip block)
 *   meta      — optional trip meta node (e.g. dates · days · cities)
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
  isTrip = false,
}) {
  const nav = useNavigate();
  const t = useT();
  const goBrand = onBrand || (() => nav('/trips'));
  const hasTrip = title != null || meta != null;

  return (
    <header className={'app-header' + (isTrip ? ' app-header--trip' : '')}>
      <div className="app-header__left">
        {onBack && (
          <button className="app-header__gbtn" onClick={onBack} title={backTitle} aria-label={backTitle || t('common.back')} type="button">
            <Icon name="back" size={17} />
          </button>
        )}
        {onMenu && (
          <button className="app-header__gbtn app-header__menu" onClick={onMenu} aria-label={t('common.menu')} type="button">
            <Icon name="list" size={18} />
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
              {/* div, not <h1>: a global `h1 { font-size: var(--fs-h2) !important }`
                  mobile rule would otherwise inflate the header title past desktop. */}
              <div className="app-header__trip-title">{title || '…'}</div>
              {meta && <div className="app-header__trip-meta">{meta}</div>}
            </div>
          </>
        )}
      </div>

      <div className="app-header__right">
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </header>
  );
}
