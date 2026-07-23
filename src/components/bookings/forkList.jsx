import React from 'react';
import { ChevronLeft, ChevronRight, Search, RotateCcw, SlidersHorizontal, ArrowUpDown, X } from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

// Shared chrome for the two fork search lists (Stay22 hotels + Viator activities)
// so the scaffolding around PartnerResultCard can't drift (TRIP-287 unification).
// The card itself + its interaction model live in PartnerResultCard; these cover
// the loading skeleton, the empty/error state, and the pager — all identical
// between the two lists apart from labels and the page-nav callback. Styling is
// the shared .fork-* class set in app.css.

// Page-number window with … gaps: [1 … cur-1 cur cur+1 … n], collapsed to the
// full run when there are ≤5 pages.
export function pageWindow(current, totalPages) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = new Set([1, totalPages, current, current - 1, current + 1]);
  const arr = [...out].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const withGaps = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) withGaps.push('…');
    withGaps.push(arr[i]);
  }
  return withGaps;
}

// Advance a sort key through its cycle (pool order → … → back to start).
export function nextSort(order, current) {
  return order[(order.indexOf(current) + 1) % order.length];
}

// Loading skeleton — N placeholder cards in the shared .pcard grid shell.
export function ForkListSkeleton({ count = 4 }) {
  return (
    <div className="fork-list" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="pcard pcard--sk" key={i}>
          <div className="pcard__thumb"><Skeleton w="100%" h="100%" r={11} /></div>
          <div className="pcard__body">
            <Skeleton w="70%" h={14} />
            <Skeleton w="90%" h={12} style={{ marginTop: 8 }} />
          </div>
          <div className="pcard__bar">
            <Skeleton w={80} h={14} />
            <span className="pcard__spacer" />
            <Skeleton w={70} h={30} r={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Empty / error / no-match state — shared medal surface (TRIP-287 redesign).
// `variant` = 'err' | 'emp' | 'nomatch' drives the accent (red / blue / yellow),
// identical across both fork lists. `icon` fills the medal, `spark` is the small
// corner badge. `action` is the optional retry/reset button; `partner` renders
// the branded "find on <partner>" button (Booking for hotels, Viator for
// activities) shown in every state — its link mirrors the partner pill above.
export function ForkState({ variant, icon, spark = null, title, body, action = null, partner = null }) {
  const { t } = useI18nFormat();
  return (
    <div className={`fork-state fork-state--${variant}`}>
      <div className="fork-state__art">
        <span className="fork-state__glow" aria-hidden="true" />
        <span className="fork-si">{icon}{spark ? <span className="fork-state__spark">{spark}</span> : null}</span>
      </div>
      <b>{title}</b>
      <p>{body}</p>
      {(action || partner) && (
        <div className="fork-state__actions">
          {action}
          {partner && (
            <a
              className="btn btn--brand btn--block"
              href={partner.url} target="_blank" rel="noreferrer" onClick={partner.onClick}
              style={{ '--bg': partner.color, '--fg': '#fff', '--bd': 'transparent' }}
            >
              <span className="btn__brandlogo"><img src={partner.logo} alt="" /></span>
              {t('booking.find_on', { name: partner.name })}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// Branded state partner — the Booking (hotels) / Viator (activities) fallback
// shown in every search state. Brand constants (display name, white-chip logo,
// button colour, click type) live HERE so both lists + the modal can't drift.
// `platform` is that partner's entry from hotelPlatforms/activityPlatforms
// (null / no url → no button); the click reuses the pill's exact affiliate link,
// logged under the fork_state_button campaign.
const STATE_BRANDS = {
  booking: { name: 'Booking.com', logo: '/partners/booking-transparent.png', color: 'var(--bk)', type: 'hotel' },
  viator: { name: 'Viator', logo: '/partners/viator.svg', color: 'var(--viator)', type: 'activity' },
};
export function buildStatePartner(platform, brandKey, logClick) {
  if (!platform?.url) return null;
  const b = STATE_BRANDS[brandKey];
  return {
    name: b.name, logo: b.logo, color: b.color, url: platform.url,
    onClick: () => logClick({ partner: brandKey, type: b.type, link: platform.url, provider: platform.provider || brandKey, campaign: 'fork_state_button', fallback: !!platform.fallback }),
  };
}

// Pager — prev · windowed page numbers · next. `onGoto(p)` is the single nav hook
// (hotels pass a variant that clears the map selection first, TRIP-141). Renders
// nothing for a single page.
export function ForkPager({ page, totalPages, pages, onGoto, prevLabel, nextLabel }) {
  if (totalPages <= 1) return null;
  return (
    <div className="fork-pager">
      <button className="fork-pg" disabled={page <= 1} onClick={() => onGoto(Math.max(1, page - 1))} aria-label={prevLabel}><ChevronLeft size={16} /></button>
      {pages.map((p, i) => (p === '…'
        ? <span key={`g${i}`} className="fork-gap">…</span>
        : <button key={p} className={`fork-pg ${p === page ? 'fork-pg--on' : ''}`} onClick={() => onGoto(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))}
      <button className="fork-pg" disabled={page >= totalPages} onClick={() => onGoto(page + 1)} aria-label={nextLabel}><ChevronRight size={16} /></button>
    </div>
  );
}

// Active-filter chip with a remove (×) button. One per applied filter.
export function ForkPill({ label, onRemove, removeLabel }) {
  return (
    <span className="s22f-pill">{label}
      <button type="button" onClick={onRemove} aria-label={removeLabel}><X size={12} /></button>
    </span>
  );
}

// Fork filter toolbar shell — search row + (when open) the filter popover body
// [children] with a reset/search footer + the active-filter pills row. The shell
// is identical for both fork lists; only the popover FIELDS (children), the pill
// list and the bound values/handlers differ (props). Shared button labels come
// from fork i18n so callers don't repeat them.
export function ForkToolbar({
  searchValue, onSearchChange, searchPlaceholder,
  filtersOpen, onToggleFilters, activeCount,
  onReset, onApply,       // popover footer (reset == pills "reset all")
  pills = [],             // [{ key, label, onRemove }] — active-filter chips
  children,               // filter popover body (per-list fields)
}) {
  const { t } = useI18nFormat();
  return (
    <div className="s22f">
      <div className="s22f-searchrow">
        <div className="s22f-search">
          <Search size={16} className="s22f-search__ic" />
          <input
            type="text" value={searchValue} onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder} aria-label={searchPlaceholder}
          />
        </div>
        <button
          type="button"
          className={`s22f-fbtn ${filtersOpen ? 's22f-fbtn--on' : ''} ${activeCount ? 's22f-fbtn--active' : ''}`}
          aria-expanded={filtersOpen} aria-label={t('fork.f_filters')} title={t('fork.f_filters')}
          onClick={onToggleFilters}
        >
          <SlidersHorizontal size={17} />
          {activeCount > 0 && <span className="badge badge--count s22f-fbtn__n">{activeCount}</span>}
        </button>
      </div>

      {filtersOpen && (
        <>
          <div className="s22f-panel">{children}</div>
          {/* Actions live OUTSIDE the filter card (design) */}
          <div className="s22f-panelfoot">
            <button type="button" className="btn btn--quiet btn--sm" onClick={onReset}>
              <RotateCcw size={14} />{t('fork.f_reset')}
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={onApply}>
              <Search size={14} />{t('fork.f_search')}
            </button>
          </div>
        </>
      )}

      {pills.length > 0 && (
        <div className="s22f-pills">
          {pills.map((p) => <ForkPill key={p.key} label={p.label} onRemove={p.onRemove} removeLabel={t('fork.f_reset')} />)}
          <button type="button" className="s22f-resetall" onClick={onReset}>{t('fork.f_reset_all')}</button>
        </div>
      )}
    </div>
  );
}

// Count + sort row above the results. countLabel (may be empty) + sortLabel are
// per-list; the cycle handler is the list's own sort stepper.
export function ForkCountRow({ countLabel, sortLabel, onCycleSort }) {
  return (
    <div className="s22-countrow">
      {countLabel ? <span className="s22-count">{countLabel}</span> : null}
      <span className="s22-countrow__ln" />
      <button type="button" className="s22-sort" onClick={onCycleSort}>
        <ArrowUpDown size={14} />{sortLabel}
      </button>
    </div>
  );
}
