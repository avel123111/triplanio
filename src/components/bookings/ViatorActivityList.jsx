import React, { useMemo, useState, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Search, RotateCcw, Ticket, AlertTriangle, Star,
  SlidersHorizontal, X, ArrowUpDown,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useViatorActivities } from '@/lib/viator';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';

// Live Viator activities for the activity fork panel — mirrors Stay22HotelList,
// down to the SHARED filter toolbar (.s22f-* in app.css). Fetches a bounded pool
// on open (useViatorActivities), then filters (title+desc / price от/до / free
// cancellation), sorts and paginates on the CLIENT — same one-pool model as the
// hotel fork. `url` (productUrl) is the attributed affiliate link — opened as-is,
// never modified.

const SKELETON_COUNT = 4;
const PAGE_SIZE = 10;
const BASE_PRICE = { min: '', max: '' };
// Client sort over the pool: default (Viator relevance order) / price ↑ / reviews ↓.
const SORT_ORDER = ['recommended', 'price', 'reviews'];

function pageWindow(current, totalPages) {
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

export default function ViatorActivityList({ visit, currency, lang, tripId }) {
  const { t, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);

  const { data, isLoading, isFetching, isError, refetch } = useViatorActivities({
    visit, currency, lang, enabled: true,
  });

  // Client-side filter (name + price) + pagination over the bounded pool.
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [pending, setPending] = useState(BASE_PRICE); // popover draft
  const [pendingFree, setPendingFree] = useState(false); // free-cancel draft in the popover
  const [applied, setApplied] = useState(BASE_PRICE);  // committed price range
  const [freeCancel, setFreeCancel] = useState(false); // committed free-cancellation filter
  const [sortBy, setSortBy] = useState('recommended');
  const cycleSort = () => setSortBy((s) => SORT_ORDER[(SORT_ORDER.indexOf(s) + 1) % SORT_ORDER.length]);
  const [page, setPage] = useState(1);
  // Selection + hover are list-local here (no map for activities) but follow the
  // SAME interaction model as hotels via PartnerResultCard: click selects, a
  // second click on the selected card opens the link (TRIP-140 unification).
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const pool = data?.activities || [];
  const appliedSig = `${applied.min}|${applied.max}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = applied.min !== '' ? Number(applied.min) : null;
    const max = applied.max !== '' ? Number(applied.max) : null;
    return pool.filter((a) => {
      // Text search spans title + description (short summary from Viator).
      if (q && !`${a.title || ''} ${a.desc || ''}`.toLowerCase().includes(q)) return false;
      if (freeCancel && !a.freeCancellation) return false;
      if (min != null || max != null) {
        if (a.fromPrice == null) return false;
        if (min != null && a.fromPrice < min) return false;
        if (max != null && a.fromPrice > max) return false;
      }
      return true;
    });
  }, [pool, query, applied, freeCancel]);

  // Sort a shallow copy so the pool order (relevance) stays intact for 'recommended'.
  const sorted = useMemo(() => {
    if (sortBy === 'recommended') return filtered;
    const arr = [...filtered];
    if (sortBy === 'price') {
      arr.sort((a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity)); // cheapest first, nulls last
    } else if (sortBy === 'reviews') {
      arr.sort((a, b) => (b.reviewCount ?? -1) - (a.reviewCount ?? -1)); // most-reviewed first, nulls last
    }
    return arr;
  }, [filtered, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shown = useMemo(() => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sorted, page]);
  const pages = useMemo(() => pageWindow(page, totalPages), [page, totalPages]);
  // Snap back to page 1 whenever the filtered/sorted set changes.
  useEffect(() => { setPage(1); }, [query, appliedSig, freeCancel, sortBy, pool.length]);

  const showSkeletons = isLoading && pool.length === 0;
  const appliedPrice = applied.min !== '' || applied.max !== '';
  const activeCount = (appliedPrice ? 1 : 0) + (freeCancel ? 1 : 0);
  const sortLabel = t(`fork.f_sort_${sortBy}`);
  const cur = currency || '';
  let priceText = `${cur} ${t('fork.f_to')} ${applied.max}`;
  if (applied.min && applied.max) priceText = `${cur} ${applied.min}–${applied.max}`;
  else if (applied.min) priceText = `${cur} ${t('fork.f_from')} ${applied.min}`;

  const setP = (k, v) => setPending((s) => ({ ...s, [k]: v.replace(/[^\d]/g, '') }));
  const applyFilters = () => { setApplied({ ...pending }); setFreeCancel(pendingFree); setFilterOpen(false); };
  const resetFilters = () => {
    setPending(BASE_PRICE); setApplied(BASE_PRICE);
    setPendingFree(false); setFreeCancel(false);
    setFilterOpen(false);
  };
  const removePrice = () => { setPending(BASE_PRICE); setApplied(BASE_PRICE); };
  const removeFree = () => { setPendingFree(false); setFreeCancel(false); };
  // Re-seed the popover draft from committed state each time it opens.
  useEffect(() => { if (filterOpen) { setPending({ ...applied }); setPendingFree(freeCancel); } }, [filterOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBook = (a) => logClick({ partner: 'viator', type: 'activity', link: a.url, provider: 'viator', campaign: 'fork_api_search', fallback: false });

  return (
    <div className="va">
      {/* ===== Search + filters — SHARED .s22f-* primitive (app.css) ===== */}
      <div className="s22f">
        <div className="s22f-searchrow">
          <div className="s22f-search">
            <Search size={16} className="s22f-search__ic" />
            <input
              type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('fork.f_search_ph_activity')} aria-label={t('fork.f_search_ph_activity')}
            />
          </div>
          <button
            type="button"
            className={`s22f-fbtn ${filterOpen ? 's22f-fbtn--on' : ''} ${activeCount ? 's22f-fbtn--active' : ''}`}
            aria-expanded={filterOpen} aria-label={t('fork.f_filters')} title={t('fork.f_filters')}
            onClick={() => setFilterOpen((o) => !o)}
          >
            <SlidersHorizontal size={17} />
            {activeCount > 0 && <span className="badge badge--count s22f-fbtn__n">{activeCount}</span>}
          </button>
        </div>

        {filterOpen && (
          <>
            <div className="s22f-panel">
              <div className="s22f-grp">
                <div className="eyebrow">{t('fork.f_price_total')}{cur ? <span className="s22f-pmuted"> ({cur})</span> : null}</div>
                <div className="s22f-pfields">
                  <label className="s22f-field">{cur ? <span className="s22f-cur">{cur}</span> : null}
                    <input type="text" inputMode="numeric" placeholder={t('fork.f_from')} value={pending.min}
                      onChange={(e) => setP('min', e.target.value)} />
                  </label>
                  <span className="s22f-dash">–</span>
                  <label className="s22f-field">{cur ? <span className="s22f-cur">{cur}</span> : null}
                    <input type="text" inputMode="numeric" placeholder={t('fork.f_to')} value={pending.max}
                      onChange={(e) => setP('max', e.target.value)} />
                  </label>
                </div>
              </div>
              <div className="s22f-grp">
                {/* Native checkbox convention (accentColor) — same as EventEditDialog's Checkbox. */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={pendingFree} onChange={(e) => setPendingFree(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--brand)', cursor: 'pointer', flexShrink: 0 }} />
                  <span className="t-ui">{t('fork.activities_free_cancel')}</span>
                </label>
              </div>
            </div>
            {/* Actions live OUTSIDE the filter card (design, same as hotel fork) */}
            <div className="s22f-panelfoot">
              <button type="button" className="btn btn--quiet btn--sm" onClick={resetFilters}>
                <RotateCcw size={14} />{t('fork.f_reset')}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={applyFilters}>
                <Search size={14} />{t('fork.f_search')}
              </button>
            </div>
          </>
        )}

        {(appliedPrice || freeCancel) && (
          <div className="s22f-pills">
            {appliedPrice && (
              <span className="s22f-pill">{priceText}<button type="button" onClick={removePrice} aria-label={t('fork.f_reset')}><X size={12} /></button></span>
            )}
            {freeCancel && (
              <span className="s22f-pill">{t('fork.activities_free_cancel')}<button type="button" onClick={removeFree} aria-label={t('fork.f_reset')}><X size={12} /></button></span>
            )}
            <button type="button" className="s22f-resetall" onClick={resetFilters}>{t('fork.f_reset_all')}</button>
          </div>
        )}
      </div>

      {!showSkeletons && !isError && sorted.length > 0 && (
        <div className="s22-countrow">
          <span className="s22-count">{t('fork.activities_count', { n: filtered.length })}</span>
          <span className="s22-countrow__ln" />
          {/* Client sort over the pool — shared .s22-sort primitive with hotels. */}
          <button type="button" className="s22-sort" onClick={cycleSort}>
            <ArrowUpDown size={14} />{sortLabel}
          </button>
        </div>
      )}

      {/* ===== States ===== */}
      {showSkeletons && (
        <div className="va-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div className="pcard pcard--sk" key={i}>
              <div className="pcard__top">
                <Skeleton w={60} h={60} r={12} />
                <div className="pcard__body">
                  <Skeleton w="70%" h={14} />
                  <Skeleton w="90%" h={12} style={{ marginTop: 8 }} />
                </div>
              </div>
              <div className="pcard__bar">
                <Skeleton w={80} h={14} />
                <span className="pcard__spacer" />
                <Skeleton w={70} h={30} r={10} />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && !showSkeletons && (
        <div className="va-state va-state--err">
          <span className="va-si"><AlertTriangle size={20} /></span>
          <b>{t('fork.activities_error_title')}</b>
          <p>{t('fork.activities_error_body')}</p>
          <button type="button" className="btn btn--soft btn--sm va-retry" onClick={() => refetch()}><RotateCcw size={14} />{t('fork.activities_retry')}</button>
        </div>
      )}

      {!isError && !showSkeletons && pool.length === 0 && (
        <div className="va-state va-state--emp">
          <span className="va-si"><Search size={20} /></span>
          <b>{t('fork.activities_empty_title')}</b>
          <p>{t('fork.activities_empty_body')}</p>
        </div>
      )}

      {!isError && !showSkeletons && pool.length > 0 && filtered.length === 0 && (
        <div className="va-state va-state--emp">
          <span className="va-si"><Search size={20} /></span>
          <b>{t('fork.activities_no_match_title')}</b>
          <p>{t('fork.activities_no_match_body')}</p>
          <button type="button" className="btn btn--soft btn--sm va-retry" onClick={resetFilters}><RotateCcw size={14} />{t('fork.f_reset')}</button>
        </div>
      )}

      {!isError && filtered.length > 0 && (
        <>
          <div className="va-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {shown.map((a) => (
              <PartnerResultCard
                key={a.code}
                id={a.code}
                name={a.title}
                accent="var(--ev-activity)"
                icon={<Ticket size={22} />}
                image={a.image}
                rating={(a.rating != null || a.freeCancellation) ? (
                  <div className="va-rate">
                    {a.rating != null && (
                      <>
                        <Star size={12} className="va-star" />
                        <span className="va-sc">{Number(a.rating).toFixed(1)}</span>
                        {a.reviewCount ? <span className="va-cnt">{t('fork.activities_reviews', { n: a.reviewCount })}</span> : null}
                      </>
                    )}
                    {a.freeCancellation && <span className="va-flag">{t('fork.activities_free_cancel')}</span>}
                  </div>
                ) : null}
                price={a.fromPrice != null ? (
                  <span className="va-price">
                    <span className="va-from">{t('fork.activities_from')}</span>
                    <b>{fmtMoney(a.fromPrice, a.currency || currency)}</b>
                  </span>
                ) : null}
                link={a.url}
                bookLabel={t('fork.activities_book')}
                selected={String(selectedId) === String(a.code)}
                hovered={String(hoveredId) === String(a.code)}
                onSelect={setSelectedId}
                onHover={setHoveredId}
                onOpen={() => onBook(a)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="va-pager">
              <button className="va-pg" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('fork.activities_prev')}><ChevronLeft size={16} /></button>
              {pages.map((p, i) => (p === '…'
                ? <span key={`g${i}`} className="va-gap">…</span>
                : <button key={p} className={`va-pg ${p === page ? 'va-pg--on' : ''}`} onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))}
              <button className="va-pg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('fork.activities_next')}><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      <style>{`
        .va { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 13px; container-type: inline-size; }
        .va-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }
        .va-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 24px 18px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--wash); }
        .va-si { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 4px; }
        .va-state--err .va-si { background: var(--danger-soft); color: var(--danger-ink); }
        .va-state--emp .va-si { background: var(--surface-2); color: var(--muted); }
        .va-state b { color: var(--ink); }
        .va-state p { margin: 0; color: var(--muted); max-width: 30ch; }
        .va-retry { margin-top: 6px; }
        /* Card shell (.pcard) is shared — see app.css + PartnerResultCard.jsx. Only
           the activity-specific body content keeps its own classes below. */
        .va-rate { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; flex: 0 1 auto; min-width: 0; }
        .va-star { color: var(--rating); flex: none; }
        .va-sc { color: var(--ink); font-variant-numeric: tabular-nums; }
        .va-cnt { color: var(--muted); }
        .va-flag { color: var(--brand); background: var(--primary-soft); padding: 1px 7px; border-radius: var(--r-pill); }
        .va-price { display: flex; flex-direction: column; align-items: flex-end; text-align: right; line-height: 1.15; /* design-token-exempt: layout line-height on the stacked price column, not text */ }
        .va-from { color: var(--muted); }  /* канон .t-micro (капс+моно) — в app.css (TRIP-175, был .t-nano+оверлей) */
        .va-price b { color: var(--ink); font-variant-numeric: tabular-nums; margin-top: 2px; }
        .va-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .va-pg { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, transform .12s ease; }
        .va-pg:disabled { opacity: .4; cursor: default; }
        .va-pg:not(:disabled):active { transform: scale(.94); }
        @media (hover: hover) and (pointer: fine) { .va-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .va-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .va-gap { color: var(--muted-2); padding: 0 2px; }
        @media (prefers-reduced-motion: reduce) { .va-pg { transition: none; } }
      `}</style>
    </div>
  );
}
