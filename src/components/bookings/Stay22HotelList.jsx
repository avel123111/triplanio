import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  MapPin, ChevronLeft, ChevronRight, ChevronDown,
  Search, RotateCcw, Minus, Plus, X, Hotel, AlertTriangle,
  SlidersHorizontal, ArrowUpDown,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';
import { STAY22_PROVIDERS } from '@/lib/stay22-normalize';

// Live Stay22 stays for the hotel fork panel (Lumo redesign v3 + filters, TRIP-224).
// Rendered under the partner block, hotel + panel only.
//
// PRESENTATIONAL: the Stay22 query + page + SERVER filters (guests + platform) +
// CLIENT filters (text / price / sort) + hovered/selected all live in
// useStay22Bundle (TripStructureEdit / the timeline drawer), so ONE filtered pool
// feeds both this list and the map badges. This component only renders and reports
// intent upward. The only local state is the filter popover's draft + open flag.
//
// TWO filter classes (TRIP-224):
//  · SERVER (reload the pool, committed via "Поиск"): guests/rooms + platform (provider).
//  · CLIENT (instant, over the pool): text search (name+address), price (TOTAL stay
//    price in the TRIP currency), sort. Price lives in the popover too but is applied
//    client-side; text + sort apply immediately from the search row / count row.

const SKELETON_COUNT = 4;
// Client-side page size over the single pool (TRIP-141): we never mount all 300
// cards at once — one slice renders at a time and its images stay lazy.
const CLIENT_PAGE_SIZE = 20;
const BASE_GUESTS = { adults: 2, children: 0, rooms: 1 };
// Sort cycle over the pool (labels via fork.f_sort_*): pool order / price ↑ / guest score ↓.
const SORT_ORDER = ['recommended', 'price', 'rating'];

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
  const cycleSort = () => onSort?.(SORT_ORDER[(SORT_ORDER.indexOf(cf.sortBy) + 1) % SORT_ORDER.length]);
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

  return (
    <div className="s22">
      {/* ===== Search + filters ===== */}
      <div className="s22f">
        <div className="s22f-searchrow">
          <div className="s22f-search">
            <Search size={16} className="s22f-search__ic" />
            {/* Client text search over the pool (name + address) — instant. */}
            <input
              type="text" value={cf.text} onChange={(e) => onSearch?.(e.target.value)}
              placeholder={t('fork.f_search_ph')} aria-label={t('fork.f_search_ph')}
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
          </div>
          {/* Actions live OUTSIDE the filter card (design) */}
          <div className="s22f-panelfoot">
            <button type="button" className="btn btn--quiet btn--sm" onClick={resetAll}>
              <RotateCcw size={14} />{t('fork.f_reset')}
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={apply}>
              <Search size={14} />{t('fork.f_search')}
            </button>
          </div>
          </>
        )}

        {(appliedGuests || appliedProvider || appliedPrice) && (
          <div className="s22f-pills">
            {appliedPrice && (
              <span className="s22f-pill">{priceText}<button type="button" onClick={removePrice} aria-label={t('fork.f_reset')}><X size={12} /></button></span>
            )}
            {appliedProvider && (
              <span className="s22f-pill">{providerLabel(appliedProvider)}<button type="button" onClick={removePlatform} aria-label={t('fork.f_reset')}><X size={12} /></button></span>
            )}
            {appliedGuests && (
              <span className="s22f-pill">
                {t('fork.f_guests', { n: (applied.adults || BASE_GUESTS.adults) + (applied.children || 0) })} · {t('fork.f_rooms', { n: applied.rooms || BASE_GUESTS.rooms })}
                <button type="button" onClick={removeGuests} aria-label={t('fork.f_reset')}><X size={12} /></button>
              </span>
            )}
            <button type="button" className="s22f-resetall" onClick={resetAll}>{t('fork.f_reset_all')}</button>
          </div>
        )}
      </div>

      {/* ===== States ===== */}
      {showSkeletons && (
        <div className="s22-list" aria-hidden="true">
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
        <div className="s22-state s22-state--err">
          <span className="s22-si"><AlertTriangle size={20} /></span>
          <b>{t('fork.stay22_error_title')}</b>
          <p>{t('fork.stay22_error_body')}</p>
          <button type="button" className="btn btn--soft btn--sm s22-retry" onClick={() => refetch()}><RotateCcw size={14} />{t('fork.stay22_retry')}</button>
        </div>
      )}

      {!isError && !showSkeletons && hotels.length === 0 && (
        <div className="s22-state s22-state--emp">
          <span className="s22-si"><Search size={20} /></span>
          <b>{t('fork.stay22_empty_title')}</b>
          <p>{t('fork.stay22_empty_body')}</p>
        </div>
      )}

      {!isError && pool.length > 0 && (
        <>
          <div className="s22-countrow">
            {countLabel && <span className="s22-count">{countLabel}</span>}
            <span className="s22-countrow__ln" />
            {/* Client sort over the pool (recommended / price ↑ / guest score ↓). */}
            <button type="button" className="s22-sort" onClick={cycleSort}>
              <ArrowUpDown size={14} />{sortLabel}
            </button>
          </div>
          <div className="s22-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {hotels.map((h) => (
              <PartnerResultCard
                key={h.id}
                ref={(n) => { if (n) cardRefs.current.set(String(h.id), n); else cardRefs.current.delete(String(h.id)); }}
                id={h.id}
                name={h.name}
                accent="var(--ev-hotel)"
                icon={<Hotel size={22} />}
                image={h.thumbnail}
                platform={h.supplierKey ? (
                  <span className="pcard__plat">
                    {h.supplierLogo ? <img src={h.supplierLogo} alt="" /> : null}
                    <span>{h.supplierKey.charAt(0).toUpperCase() + h.supplierKey.slice(1)}</span>
                  </span>
                ) : null}
                rating={(h.stars || h.ratingValue != null) ? (
                  <div className="s22-rate">
                    {h.stars ? <span className="s22-stars">{'★'.repeat(h.stars)}</span> : null}
                    {h.ratingValue != null && (
                      <span className="s22-score">
                        <span className="s22-sc">{h.ratingValue.toFixed(1)}</span>
                        {h.ratingCount ? <span className="s22-cnt">{t('fork.stay22_reviews', { n: h.ratingCount })}</span> : null}
                      </span>
                    )}
                  </div>
                ) : null}
                subline={h.address ? <div className="s22-addr"><MapPin size={13} /><span>{h.address}</span></div> : null}
                price={h.price != null ? (
                  <span className="s22-price">
                    <b>{fmtMoney(h.price, h.currency || meta.currency)}</b>
                    {meta.nights ? <span>{t('fork.stay22_for_nights', { count: meta.nights })}</span> : null}
                  </span>
                ) : null}
                link={h.link}
                bookLabel={t('fork.stay22_book')}
                selected={String(selectedId) === String(h.id)}
                hovered={String(hoveredId) === String(h.id)}
                onSelect={(id) => onSelect?.(id)}
                onHover={onHover}
                onOpen={() => onBook(h)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="s22-pager">
              <button className="s22-pg" disabled={page <= 1} onClick={() => gotoPage(Math.max(1, page - 1))} aria-label={t('fork.stay22_prev')}><ChevronLeft size={16} /></button>
              {pages.map((p, i) => (p === '…'
                ? <span key={`g${i}`} className="s22-gap">…</span>
                : <button key={p} className={`s22-pg ${p === page ? 's22-pg--on' : ''}`} onClick={() => gotoPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))}
              <button className="s22-pg" disabled={page >= totalPages} onClick={() => gotoPage(page + 1)} aria-label={t('fork.stay22_next')}><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      <style>{`
        .s22 { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 13px; container-type: inline-size; }

        /* Search + filter toolbar (.s22f-*) AND the count+sort row (.s22-countrow /
           .s22-count / .s22-sort) are SHARED fork primitives — see app.css (moved
           out of here so the activity fork reuses them, TRIP-176 / TRIP-224). */

        /* ---- list + cards ---- */
        .s22-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }

        /* ---- empty / error states ---- */
        .s22-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 24px 18px; border: 1px dashed var(--surface-card-border); border-radius: var(--r-xl); background: var(--surface-card); }  /* TRIP-176: empty/error = канон-карточка TRIP-189 (пунктир = сигнал пустоты) */
        .s22-si { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 4px; }
        .s22-state--err .s22-si { background: var(--danger-soft); color: var(--danger-ink); }
        .s22-state--emp .s22-si { background: var(--surface-2); color: var(--muted); }
        .s22-state b { color: var(--ink); }
        .s22-state p { margin: 0; color: var(--muted); max-width: 28ch; }
        .s22-retry { margin-top: 6px; }
        /* Card shell (.pcard) is shared — see app.css + PartnerResultCard.jsx. Only
           the hotel-specific body content keeps its own classes below. */
        .s22-rate { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; flex: 0 1 auto; min-width: 0; }
        .s22-stars { color: var(--rating); letter-spacing: .5px; /* design-token-exempt: разрядка глифов ★, не трекинг текста */ }
        .s22-score { display: inline-flex; align-items: center; gap: 6px; }
        .s22-sc { display: inline-grid; place-items: center; min-width: 30px; height: 19px; padding: 0 5px; border-radius: 6px 6px 6px 2px; background: var(--bk); color: var(--bk-fg); font-variant-numeric: tabular-nums; }
        .s22-cnt { color: var(--muted); }
        .s22-addr { display: flex; align-items: center; gap: 5px; color: var(--muted); overflow: hidden; }
        .s22-addr svg { flex: none; color: var(--muted-2); }
        .s22-addr span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .s22-price { display: flex; flex-direction: column; align-items: flex-end; text-align: right; line-height: 1.15; /* design-token-exempt: layout line-height on the stacked price column, not text */ }
        .s22-price b { color: var(--ink); font-variant-numeric: tabular-nums; }
        .s22-price span { color: var(--muted); margin-top: 2px; }  /* канон .t-micro (капс+моно) — в app.css (TRIP-175, был .t-nano+оверлей) */

        /* ---- pager ---- */
        .s22-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .s22-pg { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, transform .12s ease; }
        .s22-pg:disabled { opacity: .4; cursor: default; }
        .s22-pg:not(:disabled):active { transform: scale(.94); }
        @media (hover: hover) and (pointer: fine) { .s22-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .s22-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .s22-gap { color: var(--muted-2); padding: 0 2px; }

        @media (prefers-reduced-motion: reduce) {
          .s22-pg { transition: none; }
        }
      `}</style>
    </div>
  );
}
