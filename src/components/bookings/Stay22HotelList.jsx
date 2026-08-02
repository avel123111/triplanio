import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Search, RotateCcw, Minus, Plus, Hotel, AlertTriangle, SlidersHorizontal, CloudOff, X,
} from 'lucide-react';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';
import { pageWindow, nextSort, buildStatePartner, ForkListSkeleton, ForkState, ForkPager, ForkToolbar, ForkCountRow } from '@/components/bookings/forkList';
import { STAY22_PROVIDERS } from '@/lib/stay22-normalize';

// Live Stay22 stays for the hotel fork panel (Lumo redesign v3 + filters, TRIP-224).
// Rendered under the partner block, hotel + panel only.
//
// PRESENTATIONAL: the Stay22 query + page + SERVER filters (guests + platform) +
// CLIENT filters (text / price / sort) + hovered/selected all live in
// useStay22Bundle (TripStructureEdit / the timeline drawer), so ONE filtered pool
// feeds both this list and the map badges. This component only renders and reports
// intent upward. The only local state is the filter popover's draft + open flag.
// List chrome (skeleton / empty / error / pager) is shared with the activity fork
// via forkList.jsx.
//
// TWO filter classes (TRIP-224):
//  · SERVER (reload the pool, committed via "Поиск"): guests/rooms + platform (provider).
//  · CLIENT (instant, over the pool): text search (name+address), price (TOTAL stay
//    price in the TRIP currency), sort. Price lives in the popover too but is applied
//    client-side; text + sort apply immediately from the search row / count row.

const BASE_GUESTS = { adults: 2, children: 0, rooms: 1 };
// Client-side page size over the single pool (TRIP-141): we never mount all 300
// cards at once — one slice renders at a time and its images stay lazy.
const CLIENT_PAGE_SIZE = 20;
// Sort cycle over the pool (labels via fork.f_sort_*): pool order / price ↑ / guest score ↓.
const SORT_ORDER = ['recommended', 'price', 'rating'];

function Stepper({ value, min, onChange, label }) {
  return (
    <div className="s22f-step">
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${label} −`}><Minus size={15} /></button>
      <span className="s22f-val">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`${label} +`}><Plus size={15} /></button>
    </div>
  );
}

export default function Stay22HotelList({
  // Filtered pool + paging (lifted to useStay22Bundle).
  data, isLoading, isFetching, isError, refetch,
  page, onPageChange,
  // SERVER filters (guests + platform) — reload the pool.
  applied, onApply, onResetAll,
  // CLIENT filters (text / price / sort) — instant over the pool.
  clientFilters, onSearch, onApplyPrice, onSort,
  // Two-way map↔list sync.
  hoveredId, selectedId, onHover, onSelect,
  // Formatting / click logging context.
  currency, tripId,
  // Branded state button — the Booking platform entry (same link as the pill above).
  statePlatform = null,
}) {
  const { t, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);
  const cf = clientFilters || { text: '', min: '', max: '', sortBy: 'recommended' };

  // Local-only: the filter popover draft (guests + platform + price) + its open
  // flag. Re-seeded from the committed state each time the popover opens.
  const seed = () => ({
    adults: applied?.adults ?? BASE_GUESTS.adults,
    children: applied?.children ?? BASE_GUESTS.children,
    rooms: applied?.rooms ?? BASE_GUESTS.rooms,
    provider: applied?.provider || 'all',
    min: cf.min ?? '',
    max: cf.max ?? '',
  });
  const [pending, setPending] = useState(seed);
  const [filterOpen, setFilterOpen] = useState(false);
  const cycleSort = () => onSort?.(nextSort(SORT_ORDER, cf.sortBy));
  useEffect(() => { if (filterOpen) setPending(seed()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterOpen]);

  // The pool here is already client-filtered + sorted (bundle): paginate it so the
  // map (clustered) and the list (paged) read from the same filtered source.
  const pool = data?.hotels || [];
  const meta = data?.meta || {};
  const totalPages = Math.max(1, Math.ceil(pool.length / CLIENT_PAGE_SIZE));
  const hotels = useMemo(() => pool.slice((page - 1) * CLIENT_PAGE_SIZE, page * CLIENT_PAGE_SIZE), [pool, page]);
  const pages = useMemo(() => pageWindow(page, totalPages), [page, totalPages]);

  const showSkeletons = isLoading && pool.length === 0;
  const countLabel = meta.total != null
    ? (meta.truncated ? t('fork.stay22_count_plus', { n: meta.total }) : t('fork.stay22_count', { n: meta.total }))
    : '';

  // Selecting a stay from the map: jump to the client page that holds it, then
  // scroll its card into view (it may live on another page than the one shown).
  const cardRefs = useRef(new Map());
  useEffect(() => {
    if (selectedId == null) return;
    const idx = pool.findIndex((h) => String(h.id) === String(selectedId));
    if (idx < 0) return;
    const targetPage = Math.floor(idx / CLIENT_PAGE_SIZE) + 1;
    if (targetPage !== page) { onPageChange?.(targetPage); return; } // re-runs post-change → scrolls below
    const node = cardRefs.current.get(String(selectedId));
    // Center the selected card in the scroll viewport (clamps naturally for the
    // first/last cards) instead of leaving it flush at the top/bottom edge.
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedId, page, pool, onPageChange]);

  // Pager navigation clears any map selection first: otherwise the "scroll the
  // selected card into view" effect keeps yanking the list back to the selected
  // hotel's page and pagination appears stuck (TRIP-141 bugfix). The auto-scroll
  // effect calls onPageChange directly (it's navigating TO the selection), so it
  // must NOT go through here.
  const gotoPage = (p) => { onSelect?.(null); onPageChange(p); };
  const setG = (k, v) => setPending((s) => ({ ...s, [k]: v }));
  const apply = () => {
    const { adults, children, rooms, provider, min, max } = pending;
    // Server snap: guests + platform (provider only when a real platform is picked).
    onApply({ adults, children, rooms, ...(provider && provider !== 'all' ? { provider } : {}) });
    // Client snap: price range over the pool (trip currency, total stay).
    onApplyPrice?.(min, max);
    setFilterOpen(false);
  };
  const resetAll = () => { onResetAll(); setFilterOpen(false); };

  const appliedGuests = applied && (
    (applied.adults ?? BASE_GUESTS.adults) !== BASE_GUESTS.adults
    || (applied.children ?? BASE_GUESTS.children) !== BASE_GUESTS.children
    || (applied.rooms ?? BASE_GUESTS.rooms) !== BASE_GUESTS.rooms
  );
  const appliedProvider = applied?.provider || null;
  const appliedPrice = cf.min !== '' || cf.max !== '';
  const activeCount = (appliedGuests ? 1 : 0) + (appliedProvider ? 1 : 0) + (appliedPrice ? 1 : 0);
  const sortLabel = t(`fork.f_sort_${cf.sortBy}`);
  const cur = currency || '';
  const providerLabel = (key) => STAY22_PROVIDERS.find((p) => p.key === key)?.label || key;
  const priceText = cf.min && cf.max
    ? `${cur} ${cf.min} – ${cf.max}`
    : cf.min ? `${cur} ${t('fork.f_from')} ${cf.min}` : `${cur} ${t('fork.f_to')} ${cf.max}`;

  // Pill removals: guests/platform re-commit the SERVER filters; price clears the
  // CLIENT range.
  const removeGuests = () => onApply({ ...(appliedProvider ? { provider: appliedProvider } : {}) });
  const removePlatform = () => onApply({ adults: applied?.adults, children: applied?.children, rooms: applied?.rooms });
  const removePrice = () => onApplyPrice?.('', '');

  // Card click = select (no navigation); opening the supplier site (Book button
  // or a second click on the already-selected card) is logged here. The shared
  // interaction lives in PartnerResultCard so hotels + activities stay identical.
  const onBook = (h) => logClick({ partner: h.supplierKey || 'stay22', type: 'hotel', link: h.link, provider: 'stay22', campaign: 'fork_api_search', fallback: false });

  // Branded "Find on Booking" button shown in every state (shared builder).
  const brandPartner = buildStatePartner(statePlatform, 'booking', logClick);

  // Distinguish "no hotels in this city" (empty) from "filters removed everything"
  // (no-match): meta.pooled is the pre-client-filter pool size; server filters
  // reload the pool, so a filtered-to-zero API response has pooled===0 but a
  // filter still active. Any active filter (server / price / text) + zero results
  // ⇒ no-match; otherwise ⇒ empty.
  const pooledCount = meta.pooled ?? pool.length;
  const anyFilterActive = activeCount > 0 || (cf.text || '').trim() !== '';
  const isNoMatch = pool.length === 0 && (pooledCount > 0 || anyFilterActive);

  return (
    <div className="s22">
      {/* ===== Search + filters — shared ForkToolbar; only the price + platform +
           guests fields (children) are hotel-specific ===== */}
      <ForkToolbar
        searchValue={cf.text}
        onSearchChange={onSearch}
        searchPlaceholder={t('fork.f_search_ph')}
        filtersOpen={filterOpen}
        onToggleFilters={() => setFilterOpen((o) => !o)}
        activeCount={activeCount}
        onReset={resetAll}
        onApply={apply}
        pills={[
          appliedPrice && { key: 'price', label: priceText, onRemove: removePrice },
          appliedProvider && { key: 'plat', label: providerLabel(appliedProvider), onRemove: removePlatform },
          appliedGuests && {
            key: 'guests',
            label: `${t('fork.f_guests', { n: (applied.adults || BASE_GUESTS.adults) + (applied.children || 0) })} · ${t('fork.f_rooms', { n: applied.rooms || BASE_GUESTS.rooms })}`,
            onRemove: removeGuests,
          },
        ].filter(Boolean)}
      >
        <div className="s22f-grp">
          <div className="eyebrow">{t('fork.f_price_total')}{cur ? <span className="s22f-pmuted"> ({cur})</span> : null}</div>
          <div className="s22f-pfields">
            <label className="s22f-field">{cur ? <span className="s22f-cur">{cur}</span> : null}
              <input type="text" inputMode="numeric" placeholder={t('fork.f_from')} value={pending.min}
                onChange={(e) => setG('min', e.target.value.replace(/[^\d]/g, ''))} />
            </label>
            <span className="s22f-dash">–</span>
            <label className="s22f-field">{cur ? <span className="s22f-cur">{cur}</span> : null}
              <input type="text" inputMode="numeric" placeholder={t('fork.f_to')} value={pending.max}
                onChange={(e) => setG('max', e.target.value.replace(/[^\d]/g, ''))} />
            </label>
          </div>
        </div>

        <div className="s22f-grp">
          <div className="eyebrow">{t('fork.f_platform')}</div>
          <div className="s22f-selwrap">
            <select className="s22f-sel" value={pending.provider} onChange={(e) => setG('provider', e.target.value)}>
              <option value="all">{t('fork.f_all_platforms')}</option>
              {STAY22_PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <ChevronDown size={16} className="s22f-selchev" />
          </div>
        </div>

        <div className="s22f-grp">
          <div className="eyebrow">{t('fork.f_guests_rooms')}</div>
          <div className="s22f-guestgrid">
            <div className="s22f-gcard">
              <span className="s22f-gcard__l t-ui">{t('fork.f_adults_t')}</span>
              <Stepper value={pending.adults} min={1} onChange={(v) => setG('adults', v)} label={t('fork.f_adults_t')} />
            </div>
            <div className="s22f-gcard">
              <span className="s22f-gcard__l t-ui">{t('fork.f_children_t')}</span>
              <Stepper value={pending.children} min={0} onChange={(v) => setG('children', v)} label={t('fork.f_children_t')} />
            </div>
            <div className="s22f-gcard">
              <span className="s22f-gcard__l t-ui">{t('fork.f_rooms_t')}</span>
              <Stepper value={pending.rooms} min={1} onChange={(v) => setG('rooms', v)} label={t('fork.f_rooms_t')} />
            </div>
          </div>
        </div>
      </ForkToolbar>

      {/* ===== States — shared fork chrome (forkList.jsx) ===== */}
      {showSkeletons && <ForkListSkeleton />}

      {isError && !showSkeletons && (
        <ForkState
          variant="err"
          icon={<AlertTriangle size={28} />}
          spark={<CloudOff size={13} />}
          title={t('fork.stay22_error_title')}
          body={t('fork.stay22_error_body')}
          action={<button type="button" className="btn btn--soft" onClick={() => refetch()}><RotateCcw size={15} />{t('fork.stay22_retry')}</button>}
          partner={brandPartner}
        />
      )}

      {!isError && !showSkeletons && isNoMatch && (
        <ForkState
          variant="nomatch"
          icon={<SlidersHorizontal size={28} />}
          spark={<X size={13} />}
          title={t('fork.stay22_no_match_title')}
          body={t('fork.stay22_no_match_body')}
          action={<button type="button" className="btn btn--soft" onClick={resetAll}><RotateCcw size={15} />{t('fork.f_reset')}</button>}
          partner={brandPartner}
        />
      )}

      {!isError && !showSkeletons && pool.length === 0 && !isNoMatch && (
        <ForkState
          variant="emp"
          icon={<Hotel size={28} />}
          spark={<Search size={13} />}
          title={t('fork.stay22_empty_title')}
          body={t('fork.stay22_empty_body')}
          partner={brandPartner}
        />
      )}

      {!isError && pool.length > 0 && (
        <>
          <ForkCountRow countLabel={countLabel} sortLabel={sortLabel} onCycleSort={cycleSort} />
          <div className="fork-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {hotels.map((h) => (
              <PartnerResultCard
                key={h.id}
                ref={(n) => { if (n) cardRefs.current.set(String(h.id), n); else cardRefs.current.delete(String(h.id)); }}
                id={h.id}
                name={h.name}
                accent="var(--ev-hotel)"
                icon={<Hotel size={22} />}
                image={h.thumbnail}
                score={h.ratingValue != null ? (
                  <span className="pcard__score">{h.ratingValue.toFixed(1)}</span>
                ) : null}
                supplier={h.supplierKey ? (
                  <span className="pcard__sup" title={h.supplierKey.charAt(0).toUpperCase() + h.supplierKey.slice(1)}>
                    {h.supplierLogo ? <img src={h.supplierLogo} alt="" /> : h.supplierKey.charAt(0).toUpperCase()}
                  </span>
                ) : null}
                meta={(h.stars || h.ratingCount) ? (
                  <div className="pcard__meta">
                    {h.stars ? <span className="pcard__stars">{'★'.repeat(h.stars)}</span> : null}
                    {h.ratingCount ? <span className="pcard__mtx">{t('fork.stay22_reviews', { n: h.ratingCount })}</span> : null}
                  </div>
                ) : null}
                subline={h.address ? <div className="pcard__addr">{h.address}</div> : null}
                price={h.price != null ? (
                  <span className="pcard__price">
                    <b>{fmtMoney(h.price, h.currency || meta.currency)}</b>
                    {meta.nights ? <span>{t('fork.stay22_for_nights', { count: meta.nights })}</span> : null}
                  </span>
                ) : null}
                link={h.link}
                bookLabel={t('fork.stay22_book')}
                selected={String(selectedId) === String(h.id)}
                hovered={String(hoveredId) === String(h.id)}
                onSelect={onSelect}
                onHover={onHover}
                onOpen={() => onBook(h)}
              />
            ))}
          </div>

          <ForkPager
            page={page} totalPages={totalPages} pages={pages} onGoto={gotoPage}
            prevLabel={t('fork.stay22_prev')} nextLabel={t('fork.stay22_next')}
          />
        </>
      )}

      <style>{`
        .s22 { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 13px; container-type: inline-size; }
        /* Search + filter toolbar (.s22f-*), count+sort row (.s22-countrow /
           .s22-count / .s22-sort), list chrome (.fork-*) and the card (.pcard*)
           are all SHARED fork primitives — see app.css + forkList.jsx. */
      `}</style>
    </div>
  );
}
