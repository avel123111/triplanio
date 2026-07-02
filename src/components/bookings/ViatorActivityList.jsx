import React, { useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Search, RotateCcw, Ticket, AlertTriangle, Star,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useViatorActivities } from '@/lib/viator';
import PartnerResultCard from '@/components/bookings/PartnerResultCard';

// Live Viator activities for the activity fork panel — mirrors Stay22HotelList.
// Rendered under the partner block (activity + panel only). Fetches on open via
// the viatorActivities edge function; nothing persisted. `url` (productUrl) is the
// attributed affiliate link — opened as-is, never modified.

const SKELETON_COUNT = 4;
const PAGE_SIZE = 10;

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
  const [page, setPage] = useState(1);
  // Selection + hover are list-local here (no map for activities) but follow the
  // SAME interaction model as hotels via PartnerResultCard: click selects, a
  // second click on the selected card opens the link. Keeps identical elements
  // behaving identically (TRIP-140 unification).
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const { data, isLoading, isFetching, isError, refetch } = useViatorActivities({
    visit, currency, lang, page, enabled: true,
  });

  const activities = data?.activities || [];
  const meta = data?.meta || {};
  const totalPages = meta.total ? Math.max(1, Math.ceil(meta.total / PAGE_SIZE)) : null;
  const pages = useMemo(() => (totalPages ? pageWindow(page, totalPages) : []), [page, totalPages]);
  const showSkeletons = isLoading && activities.length === 0;

  const onBook = (a) => logClick({ partner: 'viator', type: 'activity', link: a.url, provider: 'viator' });
  const cityName = visit?.city_name || visit?.cities?.name_en || '';

  return (
    <div className="va">
      {/* ===== Header ===== */}
      <div className="va-head">
        <div className="va-ti">
          <span className="va-logo"><Ticket size={15} /></span>
          <div className="va-tiwrap">
            <b>{cityName ? t('fork.activities_title', { city: cityName }) : t('fork.activities_title_generic')}</b>
            <span className="va-sub">{t('fork.activities_reviews_source')}</span>
          </div>
        </div>
        {meta.total != null && meta.total > 0 && (
          <span className="va-count">{t('fork.activities_count', { n: meta.total })}</span>
        )}
      </div>

      {/* ===== States ===== */}
      {showSkeletons && (
        <div className="va-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div className="pcard pcard--sk" key={i}>
              <Skeleton w={96} h={96} r={12} />
              <div className="pcard__body">
                <Skeleton w="80%" h={14} />
                <Skeleton w="50%" h={12} style={{ marginTop: 8 }} />
                <Skeleton w="45%" h={16} style={{ marginTop: 14 }} />
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

      {!isError && !showSkeletons && activities.length === 0 && (
        <div className="va-state va-state--emp">
          <span className="va-si"><Search size={20} /></span>
          <b>{t('fork.activities_empty_title')}</b>
          <p>{t('fork.activities_empty_body')}</p>
        </div>
      )}

      {!isError && activities.length > 0 && (
        <>
          <div className="va-list" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {activities.map((a) => (
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

          {(totalPages ? totalPages > 1 : meta.hasMore || page > 1) && (
            <div className="va-pager">
              <button className="va-pg" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('fork.activities_prev')}><ChevronLeft size={16} /></button>
              {totalPages
                ? pages.map((p, i) => (p === '…'
                    ? <span key={`g${i}`} className="va-gap">…</span>
                    : <button key={p} className={`va-pg ${p === page ? 'va-pg--on' : ''}`} disabled={isFetching} onClick={() => setPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))
                : <span className="va-pg va-pg--on">{page}</span>}
              <button className="va-pg" disabled={(totalPages ? page >= totalPages : !meta.hasMore) || isFetching} onClick={() => setPage((p) => p + 1)} aria-label={t('fork.activities_next')}><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      <style>{`
        .va { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 13px; container-type: inline-size; }
        .va-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .va-ti { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
        .va-tiwrap { display: flex; flex-direction: column; min-width: 0; }
        .va-ti b { color: var(--ink); }
        .va-sub { color: var(--muted-2); margin-top: 2px; }
        .va-logo { width: 24px; height: 24px; border-radius: 6px; flex: none; display: grid; place-items: center; background: var(--ev-activity-soft); color: var(--ev-activity); }
        .va-count { color: var(--muted); white-space: nowrap; }
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
        .va-rate { display: flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
        .va-star { color: var(--pro); flex: none; }
        .va-sc { color: var(--ink); font-variant-numeric: tabular-nums; }
        .va-cnt { color: var(--muted); }
        .va-flag { color: var(--brand); background: var(--primary-soft); padding: 1px 7px; border-radius: var(--r-pill); }
        .va-price { display: flex; flex-direction: column; line-height: 1.15; /* design-token-exempt: layout line-height on the stacked price column, not text */ }
        .va-from { color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
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
