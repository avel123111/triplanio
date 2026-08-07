import React, { useMemo, useState, useEffect } from 'react';
import { Search, RotateCcw, Ticket, AlertTriangle, Star, SlidersHorizontal, CloudOff, X } from 'lucide-react';
import { Checkbox, Input, InputGroup } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useViatorActivities } from '@/lib/viator';
import { useForkList } from '@/lib/useForkList';
import { BASE_ACTIVITY_FILTERS, applyActivityFilters } from '@/lib/viator-filters';
import { priceRangeLabel } from '@/lib/forkFilter';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';
import { pageWindow, nextSort, buildStatePartner, ForkListSkeleton, ForkState, ForkPager, ForkToolbar, ForkCountRow } from '@/components/bookings/forkList';

// Live Viator activities for the activity fork panel — mirrors Stay22HotelList,
// down to the SHARED filter toolbar (.s22f-* in app.css), the SHARED list chrome
// (skeleton / empty / error / pager via forkList.jsx) and the SHARED list STATE
// (useForkList + a pure filter spec, TRIP-293). Fetches a bounded pool on open
// (useViatorActivities), then filters (title+desc / price от/до / free
// cancellation), sorts and paginates on the CLIENT — same one-pool model as the
// hotel fork. `url` (productUrl) is the attributed affiliate link — opened as-is,
// never modified.

const PAGE_SIZE = 10;
// Which knobs the filter popover owns — declared once so the initial draft, the
// re-seed on open and the commit can't drift apart. The draft is committed into
// the shared filters object on "Поиск".
const draftOf = (f) => ({ min: f.min, max: f.max, freeCancel: f.freeCancel });
// Client sort over the pool: default (Viator relevance order) / price ↑ / reviews ↓.
const SORT_ORDER = ['recommended', 'price', 'reviews'];

export default function ViatorActivityList({ visit, currency, lang, tripId, statePlatform = null }) {
  const { t, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);

  // Branded "Find on Viator" button shown in every state (shared builder).
  const brandPartner = buildStatePartner(statePlatform, 'viator', logClick);

  const { data, isLoading, isFetching, isError, refetch } = useViatorActivities({
    visit, currency, lang, enabled: true,
  });

  // Shared list state (TRIP-293): text search, price range, free-cancellation and
  // sort all live in ONE filters object, so "Сбросить" replaces the whole object
  // and cannot forget the text query. Selection + hover are list-local here (no
  // map for activities) but follow the SAME interaction model as hotels via
  // PartnerResultCard: click selects, a second click opens the link (TRIP-140).
  const {
    filters, page, hoveredId, selectedId,
    setPage, setHoveredId, setSelectedId,
    applyFilters, resetAll,
  } = useForkList({ visitId: visit?.id || null, baseFilters: BASE_ACTIVITY_FILTERS });

  // Local-only: the filter popover draft (price + free cancellation) + its open
  // flag, re-seeded from the committed filters each time the popover opens.
  const [pending, setPending] = useState(() => draftOf(BASE_ACTIVITY_FILTERS));
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    if (filterOpen) setPending(draftOf(filters));
  }, [filterOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = data?.activities || [];
  // Filtered + sorted in one pass by the shared engine (pure, unit-tested in
  // viator-filters.test.js); 'recommended' keeps Viator's relevance order.
  const matched = useMemo(() => applyActivityFilters(pool, filters), [pool, filters]);

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const shown = useMemo(() => matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [matched, page]);
  const pages = useMemo(() => pageWindow(page, totalPages), [page, totalPages]);

  const showSkeletons = isLoading && pool.length === 0;
  const appliedPrice = filters.min !== '' || filters.max !== '';
  const activeCount = (appliedPrice ? 1 : 0) + (filters.freeCancel ? 1 : 0);
  const sortLabel = t(`fork.f_sort_${filters.sortBy}`);
  const cur = currency || '';
  const priceText = priceRangeLabel({ t, currency: cur, min: filters.min, max: filters.max });

  const setDraft = (k, v) => setPending((s) => ({ ...s, [k]: v }));
  const setP = (k, v) => setDraft(k, v.replace(/[^\d]/g, '')); // price fields: digits only
  const cycleSort = () => applyFilters({ sortBy: nextSort(SORT_ORDER, filters.sortBy) });
  const applyDraft = () => { applyFilters(pending); setFilterOpen(false); };
  // "Сбросить" everywhere (popover footer, pills row, no-match state) means the
  // SAME thing as in the hotel fork: every filter, the text query and the sort.
  const resetFilters = () => { resetAll(); setFilterOpen(false); };
  // Removing a chip must clear the popover DRAFT too, not just the committed
  // filters: the chips row stays visible while the popover is open, so a stale
  // draft would re-apply the filter on the next "Поиск" and the removal would
  // look ineffective. Same helper shape as Stay22HotelList (found in review).
  const dropChip = (patch) => { applyFilters(patch); setPending((d) => ({ ...d, ...patch })); };
  const removePrice = () => dropChip({ min: '', max: '' });
  const removeFree = () => dropChip({ freeCancel: false });

  const onBook = (a) => logClick({ partner: 'viator', type: 'activity', link: a.url, provider: 'viator', campaign: 'fork_api_search', fallback: false });

  return (
    <div className="va">
      {/* ===== Search + filters — shared ForkToolbar; only the price + free-cancel
           fields (children) are activity-specific ===== */}
      <ForkToolbar
        searchValue={filters.text}
        onSearchChange={(text) => applyFilters({ text })}
        searchPlaceholder={t('fork.f_search_ph_activity')}
        filtersOpen={filterOpen}
        onToggleFilters={() => setFilterOpen((o) => !o)}
        activeCount={activeCount}
        onReset={resetFilters}
        onApply={applyDraft}
        pills={[
          appliedPrice && { key: 'price', label: priceText, onRemove: removePrice },
          filters.freeCancel && { key: 'free', label: t('fork.activities_free_cancel'), onRemove: removeFree },
        ].filter(Boolean)}
      >
        <div className="col col--g4">
          <div className="field__label">{t('fork.f_price_total')}{cur ? <span className="s22f-pmuted"> ({cur})</span> : null}</div>
          <div className="row row--g4">
            <InputGroup className="s22f-field">{cur ? <span className="input-unit input-unit--lead">{cur}</span> : null}
              <Input num type="text" inputMode="numeric" placeholder={t('fork.f_from')} aria-label={t('fork.f_from')} value={pending.min}
                onChange={(e) => setP('min', e.target.value)} />
            </InputGroup>
            <span className="s22f-dash">–</span>
            <InputGroup className="s22f-field">{cur ? <span className="input-unit input-unit--lead">{cur}</span> : null}
              <Input num type="text" inputMode="numeric" placeholder={t('fork.f_to')} aria-label={t('fork.f_to')} value={pending.max}
                onChange={(e) => setP('max', e.target.value)} />
            </InputGroup>
          </div>
        </div>
        <div className="col col--g4">
          {/* A checkbox, not a Toggle: a draft filter that only takes effect on
              "Apply" (applyDraft), so it must not look like a flipped setting. */}
          <Checkbox
            className="t-ui"
            checked={pending.freeCancel}
            onChange={(v) => setDraft('freeCancel', v)}
            label={t('fork.activities_free_cancel')}
          />
        </div>
      </ForkToolbar>

      {!showSkeletons && !isError && matched.length > 0 && (
        <ForkCountRow
          countLabel={t('fork.activities_count', { n: matched.length })}
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

      {!isError && !showSkeletons && pool.length > 0 && matched.length === 0 && (
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

      {!isError && matched.length > 0 && (
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
                  <span className="row row--inline pcard__score pcard__score--star"><Star size={10} />{Number(a.rating).toFixed(1)}</span>
                ) : null}
                meta={a.reviewCount ? (
                  <div className="row row--a-baseline pcard__meta"><span className="trunc pcard__mtx">{t('fork.activities_reviews', { n: a.reviewCount })}</span></div>
                ) : null}
                subline={a.freeCancellation ? (
                  <div className="trunc pcard__addr pcard__addr--ok">{t('fork.activities_free_cancel')}</div>
                ) : null}
                price={a.fromPrice != null ? (
                  <span className="row row--a-baseline pcard__price">
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
           (.s22-count / .s22-sort on the shared .row primitive) are all shared —
           see app.css + forkList.jsx. */
      `}</style>
    </div>
  );
}
