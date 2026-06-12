import React, { useState, useMemo } from 'react';
import { Star, MapPin, ExternalLink, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Btn, Skeleton, EmptyState } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useStay22Accommodations } from '@/lib/stay22';

// Live Stay22 stays for the hotel fork panel. Rendered under the partner
// plashki (hotel only). Fetches on open via the stay22Accommodations edge
// function; nothing is persisted. Each card click is logged to partner_clicks.

const SKELETON_COUNT = 4;

function fmtShort(dateStr, locale) {
  if (!dateStr) return '';
  // dateStr is 'YYYY-MM-DD' (date-only city visit date); render in user locale.
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

// Windowed page list: 1 … around-current … last (max ~5 buttons).
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

export default function Stay22HotelList({ visit, currency, lang, tripId }) {
  const { t, locale, fmtMoney } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, isError, refetch } = useStay22Accommodations({
    visit, currency, lang, page, enabled: true,
  });

  const hotels = data?.hotels || [];
  const meta = data?.meta || {};
  const totalPages = meta.total ? Math.max(1, Math.ceil(meta.total / (meta.pageSize || 10))) : null;
  const pages = useMemo(() => (totalPages ? pageWindow(page, totalPages) : []), [page, totalPages]);

  const onCardClick = (h) => logClick({ partner: 'booking', type: 'hotel', link: h.url });

  // First load (no previous page kept) → skeletons.
  const showSkeletons = isLoading && hotels.length === 0;

  const dateLine = meta.checkin && meta.checkout
    ? `${fmtShort(meta.checkin, locale)} – ${fmtShort(meta.checkout, locale)}${meta.nights ? ` · ${t('fork.stay22_nights', { count: meta.nights })}` : ''}`
    : '';

  return (
    <div className="s22">
      <div className="s22-head">
        <div className="eyebrow">{t('fork.stay22_title')}</div>
        {dateLine && <div className="s22-dates">{dateLine}</div>}
      </div>

      {showSkeletons && (
        <div className="s22-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div className="s22-card s22-card--sk" key={i}>
              <Skeleton w={76} h={76} r={10} />
              <div className="s22-body">
                <Skeleton w="80%" h={13} />
                <Skeleton w="55%" h={11} style={{ marginTop: 8 }} />
                <Skeleton w="90%" h={11} style={{ marginTop: 8 }} />
                <Skeleton w="40%" h={14} style={{ marginTop: 12 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && !showSkeletons && (
        <EmptyState
          kind="error" icon="alert" title={t('fork.stay22_error_title')} body={t('fork.stay22_error_body')}
          action={<Btn variant="ghost" onClick={() => refetch()}><RefreshCw className="w-4 h-4" />{t('fork.stay22_retry')}</Btn>}
        />
      )}

      {!isError && !showSkeletons && hotels.length === 0 && (
        <EmptyState icon="search" title={t('fork.stay22_empty_title')} body={t('fork.stay22_empty_body')} />
      )}

      {!isError && hotels.length > 0 && (
        <>
          <div className="s22-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {hotels.map((h) => (
              <a
                key={h.id}
                className="s22-card"
                href={h.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => onCardClick(h)}
              >
                <div className="s22-thumb">
                  {h.thumbnail
                    ? <img src={h.thumbnail} alt={h.name} loading="lazy" />
                    : <div className="s22-thumb--ph"><MapPin size={18} /></div>}
                  {h.bookingLogo && <img className="s22-supplier" src={h.bookingLogo} alt="Booking.com" />}
                </div>

                <div className="s22-body">
                  <div className="s22-name">{h.name}</div>

                  {(h.stars || h.ratingValue) && (
                    <div className="s22-rate">
                      {h.stars ? <span className="s22-stars">{'★'.repeat(h.stars)}</span> : null}
                      {h.ratingValue != null && (
                        <span className="s22-score">
                          <Star size={11} className="s22-score-ic" />
                          {h.ratingValue.toFixed(1)}
                          {h.ratingCount ? <span className="s22-count"> · {h.ratingCount}</span> : null}
                        </span>
                      )}
                    </div>
                  )}

                  {h.address && <div className="s22-addr">{h.address}</div>}

                  <div className="s22-foot">
                    {h.price != null ? (
                      <span className="s22-price">
                        {fmtMoney(h.price, h.currency || meta.currency)}
                        {meta.nights ? <span className="s22-per"> · {t('fork.stay22_nights', { count: meta.nights })}</span> : null}
                      </span>
                    ) : <span />}
                    <span className="s22-cta">{t('fork.stay22_book')}<ExternalLink size={13} /></span>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {(totalPages ? totalPages > 1 : meta.hasMore || page > 1) && (
            <div className="s22-pager">
              <button
                className="s22-pg s22-pg--arrow" disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('fork.stay22_prev')}
              ><ChevronLeft size={16} /></button>

              {totalPages
                ? pages.map((p, i) => (p === '…'
                    ? <span key={`g${i}`} className="s22-gap">…</span>
                    : <button
                        key={p} className={`s22-pg ${p === page ? 's22-pg--on' : ''}`}
                        disabled={isFetching} onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined}
                      >{p}</button>))
                : <span className="s22-pg s22-pg--on">{page}</span>}

              <button
                className="s22-pg s22-pg--arrow"
                disabled={(totalPages ? page >= totalPages : !meta.hasMore) || isFetching}
                onClick={() => setPage((p) => p + 1)} aria-label={t('fork.stay22_next')}
              ><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      <style>{`
        .s22 { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
        .s22-head { margin-bottom: 12px; }
        .s22-dates { margin-top: 3px; font-size: var(--fs-meta); color: var(--muted); font-variant-numeric: tabular-nums; }
        .s22-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }

        .s22-card {
          display: flex; gap: 12px; padding: 10px;
          background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
          text-decoration: none; color: inherit;
          transition: transform .16s cubic-bezier(0.23,1,0.32,1), border-color .16s ease, box-shadow .16s ease;
        }
        .s22-card--sk { cursor: default; }
        @media (hover: hover) and (pointer: fine) {
          .s22-card:hover { border-color: var(--line-hover); box-shadow: var(--shadow-soft); transform: translateY(-1px); }
        }
        .s22-card:active { transform: scale(0.985); }

        .s22-thumb { position: relative; width: 76px; height: 76px; flex-shrink: 0; }
        .s22-thumb img { width: 76px; height: 76px; object-fit: cover; border-radius: 10px; background: var(--wash); display: block; }
        .s22-thumb--ph { width: 76px; height: 76px; border-radius: 10px; background: var(--wash); color: var(--muted-2); display: grid; place-items: center; }
        .s22-supplier { position: absolute; left: 4px; bottom: 4px; width: 20px !important; height: 20px !important; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,.25); }

        .s22-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .s22-name { font-weight: 600; font-size: 13.5px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .s22-rate { display: flex; align-items: center; gap: 8px; margin-top: 3px; font-size: 11.5px; }
        .s22-stars { color: var(--pro); letter-spacing: 0.5px; }
        .s22-score { display: inline-flex; align-items: center; gap: 3px; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
        .s22-score-ic { color: var(--pro); }
        .s22-count { color: var(--muted); font-weight: 400; }
        .s22-addr { margin-top: 4px; font-size: 11.5px; color: var(--muted); line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .s22-foot { margin-top: auto; padding-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .s22-price { font-weight: 700; font-size: 13.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
        .s22-per { font-weight: 400; font-size: 11px; color: var(--muted); }
        .s22-cta { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--brand); }

        .s22-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 14px; flex-wrap: wrap; }
        .s22-pg {
          min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px;
          border: 1px solid var(--line); background: var(--surface); color: var(--ink);
          font-size: 12.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          transition: background .15s ease, border-color .15s ease, transform .12s ease;
        }
        .s22-pg:disabled { opacity: 0.4; cursor: default; }
        .s22-pg:not(:disabled):active { transform: scale(0.94); }
        @media (hover: hover) and (pointer: fine) { .s22-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .s22-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .s22-gap { color: var(--muted-2); padding: 0 2px; }

        @media (prefers-reduced-motion: reduce) {
          .s22-card, .s22-pg { transition: none; }
          .s22-card:active, .s22-pg:active { transform: none; }
        }
      `}</style>
    </div>
  );
}
