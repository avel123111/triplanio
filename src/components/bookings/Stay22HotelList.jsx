import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  MapPin, ChevronLeft, ChevronRight, ChevronDown,
  Users, Search, RotateCcw, Minus, Plus, X, Hotel, AlertTriangle,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';

// Live Stay22 stays for the hotel fork panel (Lumo redesign v3 + filters).
// Rendered under the partner block, hotel + panel only.
//
// PRESENTATIONAL (TRIP-140): the single Stay22 query + page + committed filters +
// hovered/selected state are lifted to TripStructureEdit (so the same pool feeds
// the map badges). This component only renders the result and reports user intent
// upward via callbacks; the only local state is the filter popover's draft buffer
// (`pending`) and its open flag — pure UI that never touches the query directly.
// min/max are per-night price in USD (Stay22 semantics).

const SKELETON_COUNT = 4;
// Client-side page size over the single pool (TRIP-141): we never mount all 300
// cards at once — one slice renders at a time and its images stay lazy.
const CLIENT_PAGE_SIZE = 20;
const BASE_GUESTS = { adults: 2, children: 0, rooms: 1 };
const BASE_FILTERS = { ...BASE_GUESTS, min: '', max: '' };

function fmtShort(dateStr, locale) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

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
  // Query result + paging + committed filters (lifted to TripStructureEdit).
  data, isLoading, isFetching, isError, refetch,
  page, onPageChange,
  applied, onApply, onResetAll,
  // Two-way map↔list sync.
  hoveredId, selectedId, onHover, onSelect,
  // Formatting / click logging context.
  currency, tripId,
}) {
  const { t, locale, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);

  // Local-only: the filter popover draft buffer (seeded from the committed
  // filters) + its open flag. Committing "Поиск" hands the snapshot upward.
  const seed = () => ({ ...BASE_FILTERS, ...(applied || {}) });
  const appliedSig = JSON.stringify(applied || null);
  const [pending, setPending] = useState(seed);
  const [popOpen, setPopOpen] = useState(false);
  const wrapRef = useRef(null);
  // Re-seed the draft whenever the committed filters change from the outside
  // (apply / reset / pill removal in the parent) so the popover stays in sync.
  useEffect(() => { setPending(seed()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [appliedSig]);

  useEffect(() => {
    if (!popOpen) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setPopOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [popOpen]);

  // The pool is the whole city (TRIP-141): paginate it on the CLIENT so the map
  // (clustered) and the list (paged) read from one source of truth.
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

  const guestsLabel = () => {
    const p = [t('fork.f_adults', { n: pending.adults })];
    if (pending.children > 0) p.push(t('fork.f_children', { n: pending.children }));
    p.push(t('fork.f_rooms', { n: pending.rooms }));
    return p.join(' · ');
  };
  const guestsTouched = pending.adults !== BASE_GUESTS.adults || pending.children !== BASE_GUESTS.children || pending.rooms !== BASE_GUESTS.rooms;
  const priceTouched = pending.min !== '' || pending.max !== '';
  const dirty = guestsTouched || priceTouched;

  // Pager navigation clears any map selection first: otherwise the "scroll the
  // selected card into view" effect keeps yanking the list back to the selected
  // hotel's page and pagination appears stuck (TRIP-141 bugfix). The auto-scroll
  // effect calls onPageChange directly (it's navigating TO the selection), so it
  // must NOT go through here.
  const gotoPage = (p) => { onSelect?.(null); onPageChange(p); };
  const apply = () => { onApply({ ...pending }); setPopOpen(false); };
  const resetAll = () => { setPending({ ...BASE_FILTERS }); onResetAll(); setPopOpen(false); };
  const setG = (k, v) => setPending((s) => ({ ...s, [k]: v }));
  const resetGuests = () => setPending((s) => ({ ...s, ...BASE_GUESTS }));

  const appliedGuests = applied && (applied.adults !== BASE_GUESTS.adults || applied.children !== BASE_GUESTS.children || applied.rooms !== BASE_GUESTS.rooms);
  const appliedPrice = applied && (applied.min !== '' || applied.max !== '');
  const priceText = applied
    ? (applied.min && applied.max ? `$ ${applied.min} – ${applied.max}` : applied.min ? `$ ${t('fork.f_from')} ${applied.min}` : `$ ${t('fork.f_to')} ${applied.max}`)
    : '';

  // Pill removals operate on the committed filters and re-commit (the parent owns
  // `applied`; the draft re-seeds via the appliedSig effect above).
  const removeGuests = () => onApply({ ...(applied || {}), ...BASE_GUESTS });
  const removePrice = () => onApply({ ...(applied || {}), min: '', max: '' });

  const dateLine = meta.checkin && meta.checkout
    ? `${fmtShort(meta.checkin, locale)} – ${fmtShort(meta.checkout, locale)}${meta.nights ? ` · ${t('fork.stay22_nights', { count: meta.nights })}` : ''}`
    : '';

  // Card click = select (no navigation); opening the supplier site (Book button
  // or a second click on the already-selected card) is logged here. The shared
  // interaction lives in PartnerResultCard so hotels + activities stay identical.
  const onBook = (h) => logClick({ partner: h.supplierKey || 'stay22', type: 'hotel', link: h.link, provider: 'stay22' });

  return (
    <div className="s22">
      {/* ===== Header (neutral, supplier-agnostic — mirrors ViatorActivityList) —
          sits ABOVE the filters so both forks lead with the title (TRIP-161). ===== */}
      <div className="s22-head">
        <div className="s22-ti">
          <span className="s22-logo"><Hotel size={15} /></span>
          <div className="s22-tiwrap">
            <b>{t('fork.stay22_title')}</b>
            <span className="s22-sub">{t('fork.stay22_source')}{dateLine ? ` · ${dateLine}` : ''}</span>
          </div>
        </div>
        {countLabel && <span className="s22-count">{countLabel}</span>}
      </div>

      {/* ===== Filters bar ===== */}
      <div className="s22f">
        <div className="s22f-row">
          <div className="s22f-wrap" ref={wrapRef}>
            <button
              type="button"
              className={`s22f-chip ${appliedGuests ? 's22f-chip--active' : ''}`}
              aria-expanded={popOpen}
              onClick={() => setPopOpen((o) => !o)}
            >
              <Users size={14} />
              <span>{guestsLabel()}</span>
              <ChevronDown size={14} className="s22f-chev" />
            </button>
            {popOpen && (
              <div className="s22f-pop" role="dialog">
                <div className="s22f-poprow">
                  <div className="s22f-poptx"><b>{t('fork.f_adults_t')}</b><span>{t('fork.f_adults_s')}</span></div>
                  <Stepper value={pending.adults} min={1} onChange={(v) => setG('adults', v)} label={t('fork.f_adults_t')} />
                </div>
                <div className="s22f-poprow">
                  <div className="s22f-poptx"><b>{t('fork.f_children_t')}</b><span>{t('fork.f_children_s')}</span></div>
                  <Stepper value={pending.children} min={0} onChange={(v) => setG('children', v)} label={t('fork.f_children_t')} />
                </div>
                <div className="s22f-poprow">
                  <div className="s22f-poptx"><b>{t('fork.f_rooms_t')}</b><span>{t('fork.f_rooms_s')}</span></div>
                  <Stepper value={pending.rooms} min={1} onChange={(v) => setG('rooms', v)} label={t('fork.f_rooms_t')} />
                </div>
                <div className="s22f-popfoot">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={resetGuests}>{t('fork.f_reset')}</button>
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setPopOpen(false)}>{t('fork.f_apply')}</button>
                </div>
              </div>
            )}
          </div>

          <div className="s22f-price">
            <span className="s22f-plbl">{t('fork.f_price')} <span className="s22f-pmuted">{t('fork.f_price_unit')}</span></span>
            <div className="s22f-pfields">
              <label className="s22f-field"><span className="s22f-cur">$</span>
                <input type="text" inputMode="numeric" placeholder={t('fork.f_from')} value={pending.min}
                  onChange={(e) => setG('min', e.target.value.replace(/[^\d]/g, ''))} />
              </label>
              <span className="s22f-dash">–</span>
              <label className="s22f-field"><span className="s22f-cur">$</span>
                <input type="text" inputMode="numeric" placeholder={t('fork.f_to')} value={pending.max}
                  onChange={(e) => setG('max', e.target.value.replace(/[^\d]/g, ''))} />
              </label>
            </div>
          </div>
        </div>

        <div className="s22f-actions">
          <button type="button" className="btn btn--quiet btn--sm" onClick={resetAll} disabled={!dirty && !applied}>
            <RotateCcw size={14} />{t('fork.f_reset')}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={!dirty}>
            <Search size={14} />{t('fork.f_search')}
          </button>
        </div>

        {(appliedGuests || appliedPrice) && (
          <div className="s22f-pills">
            {appliedPrice && (
              <span className="s22f-pill">{priceText}<button type="button" onClick={removePrice} aria-label={t('fork.f_reset')}><X size={12} /></button></span>
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
              <Skeleton w={96} h={96} r={12} />
              <div className="pcard__body">
                <Skeleton w="80%" h={14} />
                <Skeleton w="55%" h={12} style={{ marginTop: 8 }} />
                <Skeleton w="90%" h={12} style={{ marginTop: 8 }} />
                <Skeleton w="45%" h={16} style={{ marginTop: 14 }} />
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
                thumbOverlay={h.supplierLogo ? <img className="pcard__supplier" src={h.supplierLogo} alt={h.supplierKey || ''} /> : null}
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

        /* ---- filters ---- */
        .s22f { display: flex; flex-direction: column; gap: 11px; }
        .s22f-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        .s22f-wrap { position: relative; }
        .s22f-chip { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px; border-radius: var(--r-control); border: 1.5px solid var(--line-strong); background: var(--surface); color: var(--ink); cursor: pointer; white-space: nowrap; transition: border-color .2s var(--ease-out), box-shadow .2s, transform .12s var(--ease-spring); }
        .s22f-chip:hover { border-color: var(--line-hover); }
        .s22f-chip:active { transform: scale(.98); }
        .s22f-chip svg { color: var(--muted); flex: none; }
        .s22f-chip .s22f-chev { color: var(--muted-2); transition: transform .2s var(--ease-out); }
        .s22f-chip[aria-expanded="true"] { border-color: var(--brand); box-shadow: 0 0 0 4px var(--primary-ring); }
        .s22f-chip[aria-expanded="true"] .s22f-chev { transform: rotate(180deg); }
        .s22f-chip--active { border-color: var(--brand); background: var(--primary-soft); color: var(--brand); }
        .s22f-chip--active svg { color: var(--brand); }

        .s22f-price { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
        .s22f-plbl { color: var(--ink-2); }
        .s22f-pmuted { color: var(--muted); }
        .s22f-pfields { display: flex; align-items: center; gap: 8px; }
        .s22f-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: var(--surface-3); border: 1.5px solid var(--line-strong); border-radius: var(--r-control); padding: 9px 12px; transition: border-color .2s var(--ease-out), box-shadow .2s, background .2s; }
        .s22f-field:focus-within { border-color: var(--brand); background: var(--surface); box-shadow: 0 0 0 4px var(--primary-ring); }
        .s22f-cur { color: var(--muted); flex: none; }
        .s22f-field input { border: 0; outline: 0; background: transparent; width: 100%; min-width: 0; color: var(--ink); font-variant-numeric: tabular-nums; padding: 0; }
        .s22f-field input::placeholder { color: var(--muted-2); }
        .s22f-dash { color: var(--muted-2); flex: none; }
        .s22f-actions { display: flex; gap: 8px; justify-content: flex-end; }

        .s22f-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 30; width: 280px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--sh-3); padding: 6px; }
        .s22f-poprow { display: flex; align-items: center; gap: 12px; padding: 10px; }
        .s22f-poprow + .s22f-poprow { border-top: 1px solid var(--line-2); }
        .s22f-poptx { flex: 1; min-width: 0; }
        .s22f-poptx b { display: block; color: var(--ink); }
        .s22f-poptx span { display: block; color: var(--muted); margin-top: 1px; }
        .s22f-popfoot { display: flex; gap: 8px; padding: 8px 6px 4px; }
        .s22f-popfoot .btn { flex: 1; }
        .s22f-step { display: inline-flex; align-items: center; gap: 3px; flex: none; background: var(--surface-2); border-radius: var(--r-pill); padding: 3px; }
        .s22f-step button { width: 30px; height: 30px; border: 0; background: transparent; color: var(--brand); border-radius: 50%; cursor: pointer; display: grid; place-items: center; transition: background .16s, transform .14s var(--ease-spring); }
        .s22f-step button:hover:not(:disabled) { background: var(--surface); }
        .s22f-step button:active:not(:disabled) { transform: scale(.88); }
        .s22f-step button:disabled { color: var(--muted-2); cursor: default; }
        .s22f-val { min-width: 32px; text-align: center; color: var(--ink); font-variant-numeric: tabular-nums; }

        .s22f-pills { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .s22f-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 6px 5px 11px; border-radius: var(--r-pill); background: var(--primary-soft); color: var(--brand); }
        .s22f-pill button { width: 17px; height: 17px; border-radius: 50%; border: 0; background: var(--primary-soft-2); color: var(--brand); display: grid; place-items: center; cursor: pointer; }
        .s22f-resetall { margin-left: auto; background: 0; border: 0; color: var(--muted); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
        .s22f-resetall:hover { color: var(--ink); }

        @container (max-width: 480px) {
          .s22f-row { flex-direction: column; align-items: stretch; }
          .s22f-wrap, .s22f-chip { width: 100%; }
          .s22f-chip { justify-content: space-between; }
          .s22f-price { width: 100%; min-width: 0; }
          .s22f-actions .btn { flex: 1; }
        }

        /* ---- header (neutral icon + title + subtitle, like .va-head) ---- */
        .s22-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .s22-ti { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
        .s22-ti b { color: var(--ink); }
        .s22-tiwrap { display: flex; flex-direction: column; min-width: 0; }
        .s22-sub { color: var(--muted-2); margin-top: 2px; font-variant-numeric: tabular-nums; }
        .s22-logo { width: 24px; height: 24px; border-radius: 6px; flex: none; display: grid; place-items: center; background: var(--ev-hotel-soft); color: var(--ev-hotel); }
        .s22-count { color: var(--muted); white-space: nowrap; }

        /* ---- list + cards ---- */
        .s22-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }

        /* ---- empty / error states ---- */
        .s22-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 24px 18px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--wash); }
        .s22-si { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 4px; }
        .s22-state--err .s22-si { background: var(--danger-soft); color: var(--danger-ink); }
        .s22-state--emp .s22-si { background: var(--surface-2); color: var(--muted); }
        .s22-state b { color: var(--ink); }
        .s22-state p { margin: 0; color: var(--muted); max-width: 28ch; }
        .s22-retry { margin-top: 6px; }
        /* Card shell (.pcard) is shared — see app.css + PartnerResultCard.jsx. Only
           the hotel-specific body content keeps its own classes below. */
        .s22-rate { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
        .s22-stars { color: var(--pro); letter-spacing: .5px; }
        .s22-score { display: inline-flex; align-items: center; gap: 6px; }
        .s22-sc { display: inline-grid; place-items: center; min-width: 30px; height: 19px; padding: 0 5px; border-radius: 6px 6px 6px 2px; background: var(--bk); color: var(--bk-fg); font-variant-numeric: tabular-nums; }
        .s22-cnt { color: var(--muted); }
        .s22-addr { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--muted); overflow: hidden; }
        .s22-addr svg { flex: none; color: var(--muted-2); }
        .s22-addr span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .s22-price { display: flex; flex-direction: column; line-height: 1.15; /* design-token-exempt: layout line-height on the stacked price column, not text */ }
        .s22-price b { color: var(--ink); font-variant-numeric: tabular-nums; }
        .s22-price span { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }

        /* ---- pager ---- */
        .s22-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .s22-pg { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, transform .12s ease; }
        .s22-pg:disabled { opacity: .4; cursor: default; }
        .s22-pg:not(:disabled):active { transform: scale(.94); }
        @media (hover: hover) and (pointer: fine) { .s22-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .s22-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .s22-gap { color: var(--muted-2); padding: 0 2px; }

        @media (prefers-reduced-motion: reduce) {
          .s22-pg, .s22f-chip, .s22f-step button { transition: none; }
          .s22f-chip:active { transform: none; }
        }
      `}</style>
    </div>
  );
}
