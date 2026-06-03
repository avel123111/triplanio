// Shared validation UI for the unified validation engine (Ф2+).
// - useEntityValidation: runs validateEntity, returns issues + canSubmit.
// - FieldError: inline message under a field (by canonical field token).
// - IssuesPanel: single panel listing all issues; click -> scroll/focus field.
// Messages resolve via t('validation.' + code, values). Place a
// data-vfield="<token>" attribute on each field wrapper so the panel can focus it.
import React, { useMemo, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
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
    <p className={className} style={{ marginTop: 4, fontSize: 12, lineHeight: 1.35, color }}>
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
              fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.4,
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
