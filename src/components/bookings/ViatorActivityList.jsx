import React, { useMemo, useState } from 'react';
import {
  ExternalLink, ChevronLeft, ChevronRight, Search, RotateCcw, Ticket, AlertTriangle, Star,
} from 'lucide-react';
import { Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useViatorActivities } from '@/lib/viator';

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

  const { data, isLoading, isFetching, isError, refetch } = useViatorActivities({
    visit, currency, lang, page, enabled: true,
  });

  const activities = data?.activities || [];
  const meta = data?.meta || {};
  const totalPages = meta.total ? Math.max(1, Math.ceil(meta.total / PAGE_SIZE)) : null;
  const pages = useMemo(() => (totalPages ? pageWindow(page, totalPages) : []), [page, totalPages]);
  const showSkeletons = isLoading && activities.length === 0;

  const onCardClick = (a) => logClick({ partner: 'viator', type: 'activity', link: a.url, provider: 'viator' });

  return (
    <div className="va">
      {/* ===== Header ===== */}
      <div className="va-head">
        <div className="va-ti">
          <span className="va-logo"><Ticket size={15} /></span>
          <b>{t('fork.activities_title')}</b>
        </div>
        {meta.total != null && meta.total > 0 && (
          <span className="va-count">{t('fork.activities_count', { n: meta.total })}</span>
        )}
      </div>

      {/* ===== States ===== */}
      {showSkeletons && (
        <div className="va-list" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div className="va-card va-card--sk" key={i}>
              <Skeleton w={96} h={96} r={12} />
              <div className="va-body">
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
              <a key={a.code} className="va-card" href={a.url} target="_blank" rel="noreferrer" onClick={() => onCardClick(a)}>
                <div className="va-thumb">
                  <div className="va-ph"><Ticket size={22} /></div>
                  {a.image && <img src={a.image} alt={a.title} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                </div>
                <div className="va-body">
                  <div className="va-name">{a.title}</div>
                  {(a.rating != null || a.freeCancellation) && (
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
                  )}
                  <div className="va-foot">
                    {a.fromPrice != null ? (
                      <span className="va-price">
                        <span className="va-from">{t('fork.activities_from')}</span>
                        <b>{fmtMoney(a.fromPrice, a.currency || currency)}</b>
                      </span>
                    ) : <span />}
                    <span className="btn btn--primary btn--sm">{t('fork.activities_book')}<ExternalLink size={13} /></span>
                  </div>
                </div>
              </a>
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
        .va-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .va-ti { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .va-ti b { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-strong); color: var(--ink); }
        .va-logo { width: 24px; height: 24px; border-radius: 6px; flex: none; display: grid; place-items: center; background: var(--ev-activity-soft); color: var(--ev-activity); }
        .va-count { font-size: var(--fs-meta); color: var(--muted); font-weight: 700; white-space: nowrap; }
        .va-list { display: flex; flex-direction: column; gap: 10px; transition: opacity .15s ease; }
        .va-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 24px 18px; border: 1px dashed var(--line-strong); border-radius: var(--r-md); background: var(--wash); }
        .va-si { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; margin-bottom: 4px; }
        .va-state--err .va-si { background: var(--danger-soft); color: var(--danger-ink); }
        .va-state--emp .va-si { background: var(--surface-2); color: var(--muted); }
        .va-state b { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); color: var(--ink); }
        .va-state p { margin: 0; font-size: var(--fs-meta); color: var(--muted); max-width: 30ch; }
        .va-retry { margin-top: 6px; }
        .va-card { display: flex; gap: 13px; padding: 11px; text-decoration: none; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); transition: transform .18s var(--ease-spring), border-color .16s, box-shadow .18s; }
        .va-card--sk { cursor: default; }
        @media (hover: hover) and (pointer: fine) { .va-card:hover { transform: translateY(-2px); border-color: var(--line-hover); box-shadow: var(--sh-2); } }
        .va-card:active { transform: scale(.99); }
        .va-thumb { position: relative; width: 96px; height: 96px; flex: none; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, #b6e0c8, var(--ev-activity) 120%); }
        .va-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; position: relative; z-index: 1; }
        .va-ph { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255,255,255,.85); z-index: 0; }
        .va-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .va-name { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); line-height: 1.28; color: var(--ink); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .va-rate { display: flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
        .va-star { color: var(--pro); flex: none; }
        .va-sc { font-family: var(--font-display); font-weight: 700; font-size: 12.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
        .va-cnt { font-size: 11px; color: var(--muted); font-weight: 600; }
        .va-flag { font-size: 10.5px; color: var(--brand); font-weight: 700; background: var(--primary-soft); padding: 1px 7px; border-radius: var(--r-pill); }
        .va-foot { margin-top: auto; padding-top: 9px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
        .va-price { display: flex; flex-direction: column; line-height: 1.15; }
        .va-from { font-size: var(--fs-nano); color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
        .va-price b { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-strong); color: var(--ink); font-variant-numeric: tabular-nums; margin-top: 2px; }
        .va-foot .btn { flex: none; }
        .va-pager { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
        .va-pg { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-family: var(--font-display); font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, transform .12s ease; }
        .va-pg:disabled { opacity: .4; cursor: default; }
        .va-pg:not(:disabled):active { transform: scale(.94); }
        @media (hover: hover) and (pointer: fine) { .va-pg:not(:disabled):hover { border-color: var(--line-hover); } }
        .va-pg--on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .va-gap { color: var(--muted-2); padding: 0 2px; }
        @media (prefers-reduced-motion: reduce) { .va-card, .va-pg { transition: none; } .va-card:active { transform: none; } }
        @media (max-width: 560px) { .va-thumb { width: 84px; height: 84px; } }
      `}</style>
    </div>
  );
}
