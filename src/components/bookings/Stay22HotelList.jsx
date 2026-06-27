import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  MapPin, ExternalLink, ChevronLeft, ChevronRight, ChevronDown,
  Users, Search, RotateCcw, Minus, Plus, X, Hotel, AlertTriangle,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useStay22Accommodations } from '@/lib/stay22';

// Live Stay22 stays for the hotel fork panel (Lumo redesign v3 + filters).
// Rendered under the partner block, hotel + panel only. Fetches on open via the
// stay22Accommodations edge function; nothing persisted. Filters (guests, rooms,
// price min/max) trigger a new request on "Поиск"; reset returns to the base
// request. min/max are per-night price in USD (Stay22 semantics).

const SKELETON_COUNT = 4;
const BASE_GUESTS = { adults: 2, children: 0, rooms: 1 };

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

export default function Stay22HotelList({ visit, currency, lang, tripId }) {
  const { t, locale, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);

  const [page, setPage] = useState(1);
  // pending = currently edited filters; applied = what the query uses.
  const [pending, setPending] = useState({ ...BASE_GUESTS, min: '', max: '' });
  const [applied, setApplied] = useState(null);
  const [popOpen, setPopOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!popOpen) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setPopOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [popOpen]);

  const { data, isLoading, isFetching, isError, refetch } = useStay22Accommodations({
    visit, currency, lang, page, filters: applied, enabled: true,
  });

  const hotels = data?.hotels || [];
  const meta = data?.meta || {};
  const totalPages = meta.total ? Math.max(1, Math.ceil(meta.total / (meta.pageSize || 10))) : null;
  const pages = useMemo(() => (totalPages ? pageWindow(page, totalPages) : []), [page, totalPages]);

  const showSkeletons = isLoading && hotels.length === 0;

  const guestsLabel = () => {
    const p = [t('fork.f_adults', { n: pending.adults })];
    if (pending.children > 0) p.push(t('fork.f_children', { n: pending.children }));
    p.push(t('fork.f_rooms', { n: pending.rooms }));
    return p.join(' · ');
  };
  const guestsTouched = pending.adults !== BASE_GUESTS.adults || pending.children !== BASE_GUESTS.children || pending.rooms !== BASE_GUESTS.rooms;
  const priceTouched = pending.min !== '' || pending.max !== '';
  const dirty = guestsTouched || priceTouched;

  const apply = () => { setApplied({ ...pending }); setPage(1); setPopOpen(false); };
  const resetAll = () => { setPending({ ...BASE_GUESTS, min: '', max: '' }); setApplied(null); setPage(1); setPopOpen(false); };
  const setG = (k, v) => setPending((s) => ({ ...s, [k]: v }));
  const resetGuests = () => setPending((s) => ({ ...s, ...BASE_GUESTS }));

  const appliedGuests = applied && (applied.adults !== BASE_GUESTS.adults || applied.children !== BASE_GUESTS.children || applied.rooms !== BASE_GUESTS.rooms);
  const appliedPrice = applied && (applied.min !== '' || applied.max !== '');
  const priceText = applied
    ? (applied.min && applied.max ? `$ ${applied.min} – ${applied.max}` : applied.min ? `$ ${t('fork.f_from')} ${applied.min}` : `$ ${t('fork.f_to')} ${applied.max}`)
    : '';

  const removeGuests = () => { setPending((s) => ({ ...s, ...BASE_GUESTS })); setApplied((a) => ({ ...a, ...BASE_GUESTS })); setPage(1); };
  const removePrice = () => { setPending((s) => ({ ...s, min: '', max: '' })); setApplied((a) => ({ ...a, min: '', max: '' })); setPage(1); };

  const dateLine = meta.checkin && meta.checkout
    ? `${fmtShort(meta.checkin, locale)} – ${fmtShort(meta.checkout, locale)}${meta.nights ? ` · ${t('fork.stay22_nights', { count: meta.nights })}` : ''}`
    : '';

  const onCardClick = (h) => logClick({ partner: 'booking', type: 'hotel', link: h.url, provider: 'stay22' });

  return (
    <div className="s22">
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

      {/* ===== Header ===== */}
      <div className="s22-head">
        <div className="s22-ti">
          <img className="s22-logo" src="https://r2.stay22.com/2025_booking.png" alt="Booking.com" />
          <b>{t('fork.stay22_title')}</b>
          {dateLine && <span className="s22-dates">{dateLine}</span>}
        </div>
        {meta.total != null && <span className="s22-count">{t('fork.stay22_count', { n: meta.total })}</span>}
      </div>

      {/* ===== States ===== */}
      {showSkeletons && (
        <div className="s22-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div className="s22-card s22-card--sk" key={i}>
              <Skeleton w={96} h={96} r={12} />
              <div className="s22-body">
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

      {!isError && hotels.length > 0 && (
        <>
          <div className="s22-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {hotels.map((h) => (
              <a key={h.id} className="s22-card" href={h.url} target="_blank" rel="noreferrer" onClick={() => onCardClick(h)}>
                <div className="s22-thumb">
                  <div className="s22-ph"><Hotel size={22} /></div>
                  {h.thumbnail && <img src={h.thumbnail} alt={h.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  {h.bookingLogo && <img className="s22-supplier" src={h.bookingLogo} alt="Booking.com" />}
                </div>
                <div className="s22-body">
                  <div className="s22-name">{h.name}</div>
                  {(h.stars || h.ratingValue != null) && (
                    <div className="s22-rate">
                      {h.stars ? <span className="s22-stars">{'★'.repeat(h.stars)}</span> : null}
                      {h.ratingValue != null && (
                        <span className="s22-score">
                          <span className="s22-sc">{h.ratingValue.toFixed(1)}</span>
                          {h.ratingCount ? <span className="s22-cnt">{t('fork.stay22_reviews', { n: h.ratingCount })}</span> : null}
                        </span>
                      )}
                    </div>
                  )}
                  {h.address && <div className="s22-addr"><MapPin size={13} /><span>{h.address}</span></div>}
                  <div className="s22-foot">
                    {h.price != null ? (
                      <span className="s22-price">
                        <b>{fmtMoney(h.price, h.currency || meta.currency)}</b>
                        {meta.nights ? <span>{t('fork.stay22_for_nights', { count: meta.nights })}</span> : null}
                      </span>
                    ) : <span />}
                    <span className="btn btn--primary btn--sm">{t('fork.stay22_book')}<ExternalLink size={13} /></span>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {(totalPages ? totalPages > 1 : meta.hasMore || page > 1) && (
            <div className="s22-pager">
              <button className="s22-pg" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('fork.stay22_prev')}><ChevronLeft size={16} /></button>
              {totalPages
                ? pages.map((p, i) => (p === '…'
                    ? <span key={`g${i}`} className="s22-gap">…</span>
                    : <button key={p} className={`s22-pg ${p === page ? 's22-pg--on' : ''}`} disabled={isFetching} onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))
                : <span className="s22-pg s22-pg--on">{page}</span>}
              <button className="s22-pg" disabled={(totalPages ? page >= totalPages : !meta.hasMore) || isFetching} onClick={() => setPage((p) => p + 1)} aria-label={t('fork.stay22_next')}><ChevronRight size={16} /></button>
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
        .s22f-chip { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px; border-radius: var(--r-pill); border: 1.5px solid var(--line-strong); background: var(--surface); color: var(--ink); font-family: var(--font-display); font-weight: 600; font-size: var(--fs-meta); cursor: pointer; white-space: nowrap; transition: border-color .2s var(--ease-out), box-shadow .2s, transform .12s var(--ease-spring); }
        .s22f-chip:hover { border-color: var(--line-hover); }
        .s22f-chip:active { transform: scale(.98); }
        .s22f-chip svg { color: var(--muted); flex: none; }
        .s22f-chip .s22f-chev { color: var(--muted-2); transition: transform .2s var(--ease-out); }
        .s22f-chip[aria-expanded="true"] { border-color: var(--brand); box-shadow: 0 0 0 4px var(--primary-ring); }
        .s22f-chip[aria-expanded="true"] .s22f-chev { transform: rotate(180deg); }
        .s22f-chip--active { border-color: var(--brand); background: var(--primary-soft); color: var(--brand); }
        .s22f-chip--active svg { color: var(--brand); }

        .s22f-price { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
        .s22f-plbl { font-size: 13px; font-weight: 800; color: var(--ink-2); }
        .s22f-pmuted { font-weight: 600; color: var(--muted); }
        .s22f-pfields { display: flex; align-items: center; gap: 8px; }
        .s22f-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: var(--surface-3); border: 1.5px solid var(--line-strong); border-radius: var(--r-sm); padding: 9px 12px; transition: border-color .2s var(--ease-out), box-shadow .2s, background .2s; }
        .s22f-field:focus-within { border-color: var(--brand); background: var(--surface); box-shadow: 0 0 0 4px var(--primary-ring); }
        .s22f-cur { font-family: var(--font-display); font-weight: 700; color: var(--muted); font-size: 14px; flex: none; }
        .s22f-field input { border: 0; outline: 0; background: transparent; width: 100%; min-width: 0; font: inherit; font-size: 14px; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; padding: 0; }
        .s22f-field input::placeholder { color: var(--muted-2); }
        .s22f-dash { color: var(--muted-2); font-weight: 700; flex: none; }
        .s22f-actions { display: flex; gap: 8px; justify-content: flex-end; }

        .s22f-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 30; width: 280px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--sh-3); padding: 6px; }
        .s22f-poprow { display: flex; align-items: center; gap: 12px; padding: 10px; }
        .s22f-poprow + .s22f-poprow { border-top: 1px solid var(--line-2); }
        .s22f-poptx { flex: 1; min-width: 0; }
        .s22f-poptx b { display: block; font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); color: var(--ink); }
        .s22f-poptx span { display: block; font-size: var(--fs-micro); color: var(--muted); font-weight: 600; margin-top: 1px; }
        .s22f-popfoot { display: flex; gap: 8px; padding: 8px 6px 4px; }
        .s22f-popfoot .btn { flex: 1; }
        .s22f-step { display: inline-flex; align-items: center; gap: 3px; flex: none; background: var(--surface-2); border-radius: var(--r-pill); padding: 3px; }
        .s22f-step button { width: 30px; height: 30px; border: 0; background: transparent; color: var(--brand); border-radius: 50%; cursor: pointer; display: grid; place-items: center; transition: background .16s, transform .14s var(--ease-spring); }
        .s22f-step button:hover:not(:disabled) { background: var(--surface); }
        .s22f-step button:active:not(:disabled) { transform: scale(.88); }
        .s22f-step button:disabled { color: var(--muted-2); cursor: default; }
        .s22f-val { min-width: 32px; text-align: center; font-family: var(--font-display); font-weight: 800; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }

        .s22f-pills { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .s22f-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 6px 5px 11px; border-radius: var(--r-pill); background: var(--primary-soft); color: var(--brand); font-family: var(--font-display); font-weight: 600; font-size: var(--fs-micro); }
        .s22f-pill button { width: 17px; height: 17px; border-radius: 50%; border: 0; background: var(--primary-soft-2); color: var(--brand); display: grid; place-items: center; cursor: pointer; }
        .s22f-resetall { margin-left: auto; background: 0; border: 0; color: var(--muted); font-family: var(--font-display); font-weight: 700; font-size: var(--fs-micro); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
        .s22f-resetall:hover { color: var(--ink); }

        @container (max-width: 480px) {
          .s22f-row { flex-direction: column; align-items: stretch; }
          .s22f-wrap, .s22f-chip { width: 100%; }
          .s22f-chip { justify-content: space-between; }
          .s22f-price { width: 100%; min-width: 0; }
          .s22f-actions .btn { flex: 1; }
        }

        /* ---- header ---- */
        .s22-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .s22-ti { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
        .s22-ti b { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-strong); color: var(--ink); }
        .s22-logo { width: 20px; height: 20px; border-radius: 5px; flex: none; align-self: center; box-shadow: var(--sh-1); }
        .s22-dates { font-size: var(--fs-meta); color: var(--muted); font-variant-numeric: tabular-nums; }
        .s22-count { font-size: var(--fs-meta); color: var(--muted); font-weight: 700; white-space: nowrap; }

        /* ---- list + cards ---- */
        .s22-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }

        /* ---- empty / error states ---- */
        .s22-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 24px 18px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--wash); }
        .s22-si { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 4px; }
        .s22-state--err .s22-si { background: var(--danger-soft); color: var(--danger-ink); }
        .s22-state--emp .s22-si { background: var(--surface-2); color: var(--muted); }
        .s22-state b { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); color: var(--ink); }
        .s22-state p { margin: 0; font-size: var(--fs-meta); color: var(--muted); max-width: 28ch; }
        .s22-retry { margin-top: 6px; }
        .s22-card { display: flex; gap: 13px; padding: 11px; text-decoration: none; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); transition: transform .18s var(--ease-spring), border-color .16s, box-shadow .18s; }
        .s22-card--sk { cursor: default; }
        @media (hover: hover) and (pointer: fine) { .s22-card:hover { transform: translateY(-2px); border-color: var(--line-hover); box-shadow: var(--sh-2); } }
        .s22-card:active { transform: scale(.99); }
        .s22-thumb { position: relative; width: 96px; height: 96px; flex: none; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, color-mix(in srgb, var(--ev-hotel) 45%, white), var(--ev-hotel) 120%); }
        .s22-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; position: relative; z-index: 1; }
        .s22-ph { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255,255,255,.85); z-index: 0; }
        .s22-supplier { position: absolute !important; left: 5px; bottom: 5px; z-index: 2; width: 22px !important; height: 22px !important; border-radius: 6px; background: var(--surface); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
        .s22-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .s22-name { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); line-height: 1.28; color: var(--ink); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .s22-rate { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
        .s22-stars { color: var(--pro); letter-spacing: .5px; font-size: 11px; }
        .s22-score { display: inline-flex; align-items: center; gap: 6px; }
        .s22-sc { display: inline-grid; place-items: center; min-width: 30px; height: 19px; padding: 0 5px; border-radius: 6px 6px 6px 2px; background: var(--bk); color: var(--bk-fg); font-family: var(--font-display); font-weight: 700; font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .s22-cnt { font-size: 11px; color: var(--muted); font-weight: 600; }
        .s22-addr { display: flex; align-items: center; gap: 5px; margin-top: 5px; font-size: var(--fs-micro); color: var(--muted); overflow: hidden; }
        .s22-addr svg { flex: none; color: var(--muted-2); }
        .s22-addr span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .s22-foot { margin-top: auto; padding-top: 9px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
        .s22-price { display: flex; flex-direction: column; line-height: 1.15; }
        .s22-price b { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-strong); color: var(--ink); font-variant-numeric: tabular-nums; }
        .s22-price span { font-size: var(--fs-nano); color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
        .s22-foot .btn { flex: none; }

        /* ---- pager ---- */
        .s22-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .s22-pg { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-family: var(--font-display); font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, transform .12s ease; }
        .s22-pg:disabled { opacity: .4; cursor: default; }
        .s22-pg:not(:disabled):active { transform: scale(.94); }
        @media (hover: hover) and (pointer: fine) { .s22-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .s22-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .s22-gap { color: var(--muted-2); padding: 0 2px; }

        @media (prefers-reduced-motion: reduce) {
          .s22-card, .s22-pg, .s22f-chip, .s22f-step button { transition: none; }
          .s22-card:active, .s22f-chip:active { transform: none; }
        }
        @media (max-width: 560px) { .s22-thumb { width: 84px; height: 84px; } }
      `}</style>
    </div>
  );
}
