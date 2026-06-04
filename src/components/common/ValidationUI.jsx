// Shared validation UI for the unified validation engine (Ф2+).
// - useEntityValidation: runs validateEntity, returns issues + canSubmit.
// - FieldError: inline message under a field (by canonical field token).
// - IssuesPanel: single panel listing all issues; click -> scroll/focus field.
// Messages resolve via t('validation.' + code, values). Place a
// data-vfield="<token>" attribute on each field wrapper so the panel can focus it.
import React, { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, Bed, Plane, Sparkles, Car, MapPin, ChevronRight, ChevronDown } from 'lucide-react';
import { validateEntity } from '@/lib/validation';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

export function useEntityValidation(kind, draft, ctx) {
  // validateEntity is cheap/pure; recompute per render is fine.
  const issues = validateEntity(kind, draft, ctx);
  const errors = issues.filter((i) => i.level === 'error');
  return { issues, errors, hasErrors: errors.length > 0, canSubmit: errors.length === 0 };
}

// Hybrid display state: inline shows for TOUCHED fields; the summary panel and
// full highlight show only after a SAVE attempt. Reusable across all modals.
export function useHybridValidation(kind, draft, ctx) {
  const [touched, setTouched] = useState(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const issues = validateEntity(kind, draft, ctx);
  const canSubmit = !issues.some((i) => i.level === 'error');
  const markTouched = useCallback((field) => {
    if (!field) return;
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }, []);
  const displayIssues = issues.filter((i) => submitted || (i.field && touched.has(i.field)));
  const panelIssues = submitted ? issues : [];
  const reset = useCallback(() => { setTouched(new Set()); setSubmitted(false); }, []);
  // Run onOk only when valid; otherwise reveal everything + scroll to first error.
  const attemptSubmit = useCallback((onOk) => {
    if (canSubmit) { onOk(); return; }
    setSubmitted(true);
    const f = issues.find((i) => i.level === 'error' && i.field)?.field;
    if (f && typeof document !== 'undefined') {
      document.querySelector(`[data-vfield="${CSS.escape(f)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [canSubmit, issues]);
  return { issues, displayIssues, panelIssues, canSubmit, submitted, markTouched, attemptSubmit, reset };
}

// First issue targeting `field` (errors win over warnings).
function pickFieldIssue(issues, field) {
  let warn = null;
  for (const i of issues) {
    if (i.field !== field) continue;
    if (i.level === 'error') return i;
    if (!warn) warn = i;
  }
  return warn;
}

export function FieldError({ issues, field, className = '' }) {
  const { t } = useI18nFormat();
  const issue = pickFieldIssue(issues || [], field);
  if (!issue) return null;
  const color = issue.level === 'error' ? 'var(--danger, #e74c3c)' : 'var(--warning, #c9a81a)';
  return (
    <p className={className} style={{ marginTop: 4, fontSize: 'var(--fs-meta)', lineHeight: 1.35, color }}>
      {t(`validation.${issue.code}`, issue.values)}
    </p>
  );
}

// True when `field` has a blocking error - for red-border styling on the wrapper.
export function fieldHasError(issues, field) {
  return (issues || []).some((i) => i.field === field && i.level === 'error');
}

function focusField(field) {
  if (!field) return;
  const el = document.querySelector(`[data-vfield="${CSS.escape(field)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const focusable = el.querySelector('input, textarea, select, button, [tabindex]');
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 250);
}

export function IssuesPanel({ issues = [], className = '', style = {} }) {
  const { t } = useI18nFormat();
  const list = useMemo(
    () => [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)),
    [issues],
  );
  if (list.length === 0) return null;
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {list.map((it, i) => {
        const isErr = it.level === 'error';
        const stripe = isErr ? 'var(--danger, #e74c3c)' : 'var(--warning, #c9a81a)';
        const bg = isErr ? 'var(--danger-soft, #fde8e8)' : 'var(--warning-soft, #fff3cd)';
        return (
          <button
            key={`${it.code}-${i}`}
            type="button"
            onClick={() => focusField(it.field)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
              padding: '8px 11px', borderRadius: 10, border: `1px solid color-mix(in srgb, ${stripe} 40%, transparent)`,
              background: bg, color: 'var(--ink)', cursor: it.field ? 'pointer' : 'default',
              fontFamily: 'var(--font-body)', fontSize: 'var(--fs-meta)', lineHeight: 1.4,
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" style={{ marginTop: 1, flexShrink: 0, color: stripe }} />
            <span>{t(`validation.${it.code}`, it.values)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Conflicts panel (timeline + Edit Mode) ──────────────────────────────────
// Entity-attributed rows: event-type icon in event color + entity name + rule.
// Resolves which entity an issue belongs to so it's clear at a glance.
const ENTITY_META = {
  hotel: { Icon: Bed, color: 'var(--ev-hotel, #2f7d6b)', soft: 'var(--ev-hotel-soft, rgba(47,125,107,.14))' },
  activity: { Icon: Sparkles, color: 'var(--ev-activity, #7a4ee2)', soft: 'var(--ev-activity-soft, rgba(122,78,226,.14))' },
  transfer: { Icon: Plane, color: 'var(--ev-transfer, #5b6cff)', soft: 'var(--ev-transfer-soft, rgba(91,108,255,.14))' },
  service: { Icon: Car, color: 'var(--ev-service, #c9603a)', soft: 'var(--ev-service-soft, rgba(201,96,58,.14))' },
  city: { Icon: MapPin, color: 'var(--brand, #3b5bdb)', soft: 'var(--brand-soft, rgba(59,91,219,.12))' },
};

// Resolve an issue to its display: { Icon, color, soft, title, sub }.
// `ctx` carries the live entity collections so we can show the real name.
export function describeIssue(issue, ctx = {}, t = (k) => k) {
  const { hotels = [], activities = [], transfers = [] } = ctx;
  const v = issue.values || {};
  // Entity kind: explicit, else inferred from a paired structure code.
  let kind = issue.entityKind;
  if (!kind) kind = (issue.code === 'DUP_TRANSFER') ? 'transfer' : 'city';
  const meta = ENTITY_META[kind] || ENTITY_META.city;

  let title;
  if (kind === 'hotel') {
    title = hotels.find((h) => h.id === issue.entityId)?.name || t('event.type_hotel');
  } else if (kind === 'activity') {
    title = v.title || activities.find((a) => a.id === issue.entityId)?.title || t('event.type_activity');
  } else if (kind === 'transfer') {
    title = (v.from && v.to) ? `${v.from} → ${v.to}`
      : (v.a && v.b) ? `${v.a} → ${v.b}`
        : t('event.type_transfer');
  } else { // city / pair
    title = (v.a && v.b) ? `${v.a} ↔ ${v.b}` : (v.city || t('visit.city'));
  }
  return { ...meta, title, sub: t(`validation.${issue.code}`, v) };
}

// Expandable panel. `issues` = raw validateTrip issues; `ctx` = { hotels, activities,
// transfers, visits }. onOpen(issue) is called when a row is clicked.
export function ConflictsPanel({ issues = [], ctx = {}, onOpen, defaultExpanded = false, style = {} }) {
  const { t } = useI18nFormat();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const list = useMemo(
    () => [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)),
    [issues],
  );
  if (list.length === 0) return null;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', overflow: 'hidden', ...style }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
      >
        <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <AlertTriangle className="w-4 h-4" />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 'var(--fs-strong)', color: 'var(--ink)' }}>{t('validation.panel_title')}</span>
          <span style={{ display: 'block', fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>{t('validation.panel_subtitle', { n: list.length })}</span>
        </span>
        <span style={{ minWidth: 24, height: 24, padding: '0 7px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-meta)', fontWeight: 700, flexShrink: 0 }}>{list.length}</span>
        <Chevron className="w-4 h-4" style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line-2)' }}>
          {list.map((it, i) => {
            const d = describeIssue(it, ctx, t);
            const stripe = it.level === 'error' ? 'var(--danger, #e74c3c)' : d.color;
            return (
              <button
                key={`${it.code}-${it.entityId || it.fromId || i}`}
                type="button"
                onClick={() => onOpen?.(it)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '12px 16px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--line-2)' : 'none', boxShadow: `inset 3px 0 0 ${stripe}`, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 9, background: d.soft, color: d.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <d.Icon className="w-4 h-4" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--fs-strong)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.35 }}>{d.sub}</span>
                </span>
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
