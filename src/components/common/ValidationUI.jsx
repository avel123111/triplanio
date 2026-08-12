// Shared validation UI for the unified validation engine (Ф2+).
// - FieldError: inline message under a field (by canonical field token).
// - IssuesPanel: single panel listing all issues; click -> scroll/focus field.
// Messages resolve via t('validation.' + code, values). Place a
// data-vfield="<token>" attribute on each field wrapper so the panel can focus it.
import React, { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, BedDouble, Plane, Ticket, Car, MapPin, ChevronRight, ChevronDown } from 'lucide-react';
import { validateEntity, issuesToShow, isFieldRequired } from '@/lib/validation';
import { Card } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

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
  // Same reveal policy as the event editor (no AI parse on these forms). The
  // panel is that policy with nothing touched: all or nothing, one predicate.
  const displayIssues = issuesToShow(issues, { submitted, touched });
  const panelIssues = issuesToShow(issues, { submitted });
  const reset = useCallback(() => { setTouched(new Set()); setSubmitted(false); }, []);
  // Обязательность спрашиваем у валидатора, а не размечаем на экране: звёздочка
  // не может оказаться там, где сохранение на самом деле пройдёт (TRIP-333).
  const isRequired = useCallback((field) => isFieldRequired(kind, draft, ctx, field), [kind, draft, ctx]);
  // Run onOk only when valid; otherwise reveal everything + scroll to first error.
  const attemptSubmit = useCallback((onOk) => {
    if (canSubmit) { onOk(); return; }
    setSubmitted(true);
    const f = issues.find((i) => i.level === 'error' && i.field)?.field;
    if (f && typeof document !== 'undefined') {
      document.querySelector(`[data-vfield="${CSS.escape(f)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [canSubmit, issues]);
  return { issues, displayIssues, panelIssues, canSubmit, submitted, markTouched, attemptSubmit, reset, isRequired };
}

// First issue targeting `field` - a token, or a LIST of tokens that share one
// state (the date blocks: «начало+конец» one colour for the pair). Errors win
// over warnings, on either end of the pair.
function pickFieldIssue(issues, field) {
  const fields = (Array.isArray(field) ? field : [field]).filter(Boolean);
  let warn = null;
  for (const i of issues) {
    if (!fields.includes(i.field)) continue;
    if (i.level === 'error') return i;
    if (!warn) warn = i;
  }
  return warn;
}

export function FieldError({ issues, field, className = '' }) {
  const { t } = useI18nFormat();
  const issue = pickFieldIssue(issues || [], field);
  if (!issue) return null;
  const isErr = issue.level === 'error';
  return (
    <span className={`${isErr ? 'err' : 'wrn'}${className ? ' ' + className : ''}`} style={{ marginTop: 4 }}>
      {isErr
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>}
      <span>{t(`validation.${issue.code}`, issue.values)}</span>
    </span>
  );
}

// Состояние поля ГОТОВЫМИ АТРИБУТАМИ под spread (TRIP-333): `<Input {...st(f)}>`,
// `<select {...st(f)}>`, `<InputGroup {...st(f)}>` - одна форма на все контролы,
// сырые и наши. Своего пропа компоненты не заводят: проп был бы вторым способом
// сказать то же самое, а такая пара всегда расходится (TRIP-293).
//
// `aria-invalid` вместо своего data-атрибута - это стандартный признак, его
// объявляет скринридер; в приложении не было ни одного. Ошибка старше
// предупреждения: оба сразу поле не показывает никогда.
//
// `field` может быть МАССИВОМ - тогда состояние считается по паре и садится на
// контейнер, как у `<InputGroup>`: это блоки дат редактора события, где
// «начало+конец» - одно состояние на двоих, а цвет несёт рамка `.stay-dates`
// внутри (у самих ячеек её нет). Раньше эта половина жила отдельной парой
// функций, возвращавших булевы под классы (`.is-invalid` / `.field--warning`),
// то есть «как выглядит ошибка» было объявлено в ДВУХ местах. На контейнере
// `aria-invalid` - общий словарь и зацепка для CSS, но НЕ объявление для
// скринридера: тот читает признак на контроле, а не на `<div>`.
/** ⚠️ Возврат аннотирован НАРОЧНО. Без аннотации TS расширяет литерал `'true'`
 *  до `string`, а React у `aria-invalid` ждёт `Booleanish | 'grammar' |
 *  'spelling'` - и spread `{...fieldState(...)}` на поле краснел TS2322 на
 *  экране под `// @ts-check`. Значение при этом ВЕРНОЕ, ломалось только его
 *  расширение: тот же класс, что запечатанный набор пропов - молча выведенный
 *  тип расходится с тем, что здесь на самом деле возвращается.
 *  @returns {{ 'aria-invalid'?: 'true', 'data-warning'?: '' }} */
export function fieldState(issues, field) {
  const issue = pickFieldIssue(issues || [], field);
  const invalid = issue?.level === 'error';
  return {
    'aria-invalid': invalid ? 'true' : undefined,
    'data-warning': issue && !invalid ? '' : undefined,
  };
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
        const stripe = isErr ? 'var(--danger)' : 'var(--warning)';
        const bg = isErr ? 'var(--danger-soft)' : 'var(--warning-soft)';
        return (
          <button
            key={`${it.code}-${i}`}
            type="button"
            className="t-meta"
            onClick={() => focusField(it.field)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
              padding: '8px 11px', borderRadius: 'var(--r-sm)', border: `1px solid color-mix(in srgb, ${stripe} 40%, transparent)`,
              background: bg, color: 'var(--ink)', cursor: it.field ? 'pointer' : 'default',
            }}
          >
            <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0, color: stripe }} />
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
  hotel: { Icon: BedDouble, color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)' },
  activity: { Icon: Ticket, color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)' },
  transfer: { Icon: Plane, color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)' },
  service: { Icon: Car, color: 'var(--ev-service)', soft: 'var(--ev-service-soft)' },
  city: { Icon: MapPin, color: 'var(--brand)', soft: 'var(--brand-soft)' },
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
    // TRIP-343 объект 2 (канал 3): инлайн-облик поверхности (--surface + рамка +
    // r-md + overflow:hidden) снят — скин несёт <Card radius="md" pad="none">; внешний
    // style пробрасывается (позиционирование вызывателя).
    <Card radius="md" pad="none" style={style}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <AlertTriangle size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="t-ui" style={{ display: 'block', color: 'var(--ink)' }}>{t('validation.panel_title')}</span>
          <span className="t-meta" style={{ display: 'block', color: 'var(--muted)' }}>{t('validation.panel_subtitle', { n: list.length })}</span>
        </span>
        <span className="t-meta" style={{ minWidth: 24, height: 24, padding: '0 7px', borderRadius: 'var(--r-pill)', background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{list.length}</span>
        <Chevron size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {list.map((it, i) => {
            const d = describeIssue(it, ctx, t);
            const stripe = it.level === 'error' ? 'var(--danger)' : d.color;
            return (
              <button
                key={`${it.code}-${it.entityId || it.fromId || i}`}
                type="button"
                onClick={() => onOpen?.(it)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '12px 16px', background: 'transparent', border: 'none', borderTop: i ? '1px solid var(--line)' : 'none', boxShadow: `inset 3px 0 0 ${stripe}`, cursor: 'pointer' }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', background: d.soft, color: d.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <d.Icon size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t-ui" style={{ display: 'block', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
                  <span className="t-meta" style={{ display: 'block', color: 'var(--muted)' }}>{d.sub}</span>
                </span>
                <ChevronRight size={16} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
