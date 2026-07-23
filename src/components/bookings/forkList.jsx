import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/design/index';

// Shared chrome for the two fork search lists (Stay22 hotels + Viator activities)
// so the scaffolding around PartnerResultCard can't drift (TRIP-287 unification).
// The card itself + its interaction model live in PartnerResultCard; these cover
// the loading skeleton, the empty/error state, and the pager — all identical
// between the two lists apart from labels and the page-nav callback. Styling is
// the shared .fork-* class set in app.css.

// Page-number window with … gaps: [1 … cur-1 cur cur+1 … n], collapsed to the
// full run when there are ≤5 pages.
export function pageWindow(current, totalPages) {
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

// Advance a sort key through its cycle (pool order → … → back to start).
export function nextSort(order, current) {
  return order[(order.indexOf(current) + 1) % order.length];
}

// Loading skeleton — N placeholder cards in the shared .pcard grid shell.
export function ForkListSkeleton({ count = 4 }) {
  return (
    <div className="fork-list" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="pcard pcard--sk" key={i}>
          <div className="pcard__thumb"><Skeleton w="100%" h="100%" r={11} /></div>
          <div className="pcard__body">
            <Skeleton w="70%" h={14} />
            <Skeleton w="90%" h={12} style={{ marginTop: 8 }} />
          </div>
          <div className="pcard__bar">
            <Skeleton w={80} h={14} />
            <span className="pcard__spacer" />
            <Skeleton w={70} h={30} r={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Empty / error state — canon TRIP-189 dashed surface. `variant` = 'err' | 'emp';
// `action` is an optional trailing node (retry / reset button).
export function ForkState({ variant, icon, title, body, action = null }) {
  return (
    <div className={`fork-state fork-state--${variant}`}>
      <span className="fork-si">{icon}</span>
      <b>{title}</b>
      <p>{body}</p>
      {action}
    </div>
  );
}

// Pager — prev · windowed page numbers · next. `onGoto(p)` is the single nav hook
// (hotels pass a variant that clears the map selection first, TRIP-141). Renders
// nothing for a single page.
export function ForkPager({ page, totalPages, pages, onGoto, prevLabel, nextLabel }) {
  if (totalPages <= 1) return null;
  return (
    <div className="fork-pager">
      <button className="fork-pg" disabled={page <= 1} onClick={() => onGoto(Math.max(1, page - 1))} aria-label={prevLabel}><ChevronLeft size={16} /></button>
      {pages.map((p, i) => (p === '…'
        ? <span key={`g${i}`} className="fork-gap">…</span>
        : <button key={p} className={`fork-pg ${p === page ? 'fork-pg--on' : ''}`} onClick={() => onGoto(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>))}
      <button className="fork-pg" disabled={page >= totalPages} onClick={() => onGoto(page + 1)} aria-label={nextLabel}><ChevronRight size={16} /></button>
    </div>
  );
}
