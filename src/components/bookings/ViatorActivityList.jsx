import React, { useMemo, useState, useEffect } from 'react';
import { Search, RotateCcw, Ticket, AlertTriangle, Star, SlidersHorizontal, CloudOff, X } from 'lucide-react';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useViatorActivities } from '@/lib/viator';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';
import { pageWindow, nextSort, ForkListSkeleton, ForkState, ForkPager, ForkToolbar, ForkCountRow } from '@/components/bookings/forkList';

// Live Viator activities for the activity fork panel — mirrors Stay22HotelList,
// down to the SHARED filter toolbar (.s22f-* in app.css) and the SHARED list
// chrome (skeleton / empty / error / pager via forkList.jsx). Fetches a bounded
// pool on open (useViatorActivities), then filters (title+desc / price от/до /
// free cancellation), sorts and paginates on the CLIENT — same one-pool model as
// the hotel fork. `url` (productUrl) is the attributed affiliate link — opened
// as-is, never modified.

const PAGE_SIZE = 10;
const BASE_PRICE = { min: '', max: '' };
// Client sort over the pool: default (Viator relevance order) / price ↑ / reviews ↓.
const SORT_ORDER = ['recommended', 'price', 'reviews'];

export default function ViatorActivityList({ visit, currency, lang, tripId, statePartner = null }) {
  const { t, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);

  // Branded "Find on Viator" button shown in every state — same link as the
  // Viator pill above, logged under its own state-button campaign.
  const brandPartner = statePartner && statePartner.url ? {
    ...statePartner,
    onClick: () => logClick({ partner: 'viator', type: 'activity', link: statePartner.url, provider: statePartner.provider || 'viator', campaign: 'fork_state_button', fallback: !!statePartner.fallback }),
  } : null;

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
  const cycleSort = () => setSortBy((s) => nextSort(SORT_ORDER, s));
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
  // Snap back to page 1 whenever the user changes the result set (search / filter /
  // sort). NOT on pool growth: background Viator pages append to the pool, and
  // resetting on pool.length would yank the reader back to page 1 mid-browse.
  useEffect(() => { setPage(1); }, [query, appliedSig, freeCancel, sortBy]);

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
      {/* ===== Search + filters — shared ForkToolbar; only the price + free-cancel
           fields (children) are activity-specific ===== */}
      <ForkToolbar
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder={t('fork.f_search_ph_activity')}
        filtersOpen={filterOpen}
        onToggleFilters={() => setFilterOpen((o) => !o)}
        activeCount={activeCount}
        onReset={resetFilters}
        onApply={applyFilters}
        pills={[
          appliedPrice && { key: 'price', label: priceText, onRemove: removePrice },
          freeCancel && { key: 'free', label: t('fork.activities_free_cancel'), onRemove: removeFree },
        ].filter(Boolean)}
      >
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
      </ForkToolbar>

      {!showSkeletons && !isError && sorted.length > 0 && (
        <ForkCountRow
          countLabel={t('fork.activities_count', { n: filtered.length })}
          sortLabel={sortLabel}
          onCycleSort={cycleSort}
        />
      )}

      {/* ===== States — shared fork chrome (forkList.jsx) ===== */}
      {showSkeletons && <ForkListSkeleton />}

      {isError && !showSkeletons && (
        <ForkState
          variant="err"
          icon={<AlertTriangle size={28} />}
          spark={<CloudOff size={13} />}
          title={t('fork.activities_error_title')}
          body={t('fork.activities_error_body')}
          action={<button type="button" className="btn btn--soft" onClick={() => refetch()}><RotateCcw size={15} />{t('fork.activities_retry')}</button>}
          partner={brandPartner}
        />
      )}

      {!isError && !showSkeletons && pool.length === 0 && (
        <ForkState
          variant="emp"
          icon={<Ticket size={28} />}
          spark={<Search size={13} />}
          title={t('fork.activities_empty_title')}
          body={t('fork.activities_empty_body')}
          partner={brandPartner}
        />
      )}

      {!isError && !showSkeletons && pool.length > 0 && filtered.length === 0 && (
        <ForkState
          variant="nomatch"
          icon={<SlidersHorizontal size={28} />}
          spark={<X size={13} />}
          title={t('fork.activities_no_match_title')}
          body={t('fork.activities_no_match_body')}
          action={<button type="button" className="btn btn--soft" onClick={resetFilters}><RotateCcw size={15} />{t('fork.f_reset')}</button>}
          partner={brandPartner}
        />
      )}

      {!isError && filtered.length > 0 && (
        <>
          <div className="fork-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {shown.map((a) => (
              <PartnerResultCard
                key={a.code}
                id={a.code}
                name={a.title}
                accent="var(--ev-activity)"
                icon={<Ticket size={22} />}
                image={a.image}
                score={a.rating != null ? (
                  <span className="pcard__score pcard__score--star"><Star size={10} />{Number(a.rating).toFixed(1)}</span>
                ) : null}
                meta={a.reviewCount ? (
                  <div className="pcard__meta"><span className="pcard__mtx">{t('fork.activities_reviews', { n: a.reviewCount })}</span></div>
                ) : null}
                subline={a.freeCancellation ? (
                  <div className="pcard__addr pcard__addr--ok">{t('fork.activities_free_cancel')}</div>
                ) : null}
                price={a.fromPrice != null ? (
                  <span className="pcard__price">
                    <span>{t('fork.activities_from')}</span>
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

          <ForkPager
            page={page} totalPages={totalPages} pages={pages} onGoto={setPage}
            prevLabel={t('fork.activities_prev')} nextLabel={t('fork.activities_next')}
          />
        </>
      )}

      <style>{`
        .va { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 13px; container-type: inline-size; }
        /* List chrome (.fork-*) + card (.pcard*) + toolbar (.s22f-*) + count row
           (.s22-countrow) are all shared — see app.css + forkList.jsx. */
      `}</style>
    </div>
  );
}
